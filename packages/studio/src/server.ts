import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type {
  CandidateExecutionPlan,
  ExecutionPlan,
  HtmlArtifactMode,
  RunEvent,
  TestResult,
  TestRunComparison,
  TestRunManifest,
  TestRunSummary,
} from '@pickle-spec/runner'
import type {
  SpecificationMetadata,
  StructuredSpecification,
} from '@pickle-spec/spec'
import { specificationSourceDiff } from '@pickle-spec/spec'
import tailwind from 'bun-plugin-tailwind'
import {
  createSpecificationWorkspace,
  type DiskChangeEvent,
  DocumentConflictError,
  type SpecificationWorkspace,
} from './documents'
import { createGitWorkspace, type GitWorkspace } from './git'

export interface StudioScenario {
  id: string
  name: string
  canRun?: boolean
}

export interface StudioExternalLink {
  namespace: string
  id: string
}

export interface StudioSpecification {
  id: string
  name: string
  uri: string
  state?: 'draft' | 'active' | 'deprecated'
  tags?: readonly string[]
  links?: readonly StudioExternalLink[]
  canRun?: boolean
  runReasons?: readonly string[]
  scenarios: readonly StudioScenario[]
}

export interface StudioSuite {
  name: string
  paths?: string | readonly string[]
  tagExpression?: string
  states?: readonly ('draft' | 'active' | 'deprecated')[]
  scenarioName?: string
}

export interface StudioProfile {
  id: string
  adapter: string
  capabilities?: readonly string[]
}

export interface StudioCredential {
  name: string
  present: boolean
}

export interface StudioRunReadiness {
  ready: boolean
  reasons: readonly string[]
}

export interface StudioConfigPatch {
  suites?: Record<
    string,
    {
      paths?: string | readonly string[]
      tagExpression?: string
      states?: readonly ('draft' | 'active' | 'deprecated')[]
      scenarioName?: string
    }
  >
  executionTargetProfiles?: Record<
    string,
    { adapter: string; capabilities?: readonly string[] }
  >
  links?: Record<string, string>
  secrets?: Record<string, { keychain: string }>
}

export interface StudioAuthoringModel {
  provider: string
  name: string
}

export interface StudioProject {
  name: string
  root: string
  profiles: readonly string[]
  suites: readonly string[]
  specifications: readonly StudioSpecification[]
  model?: StudioAuthoringModel
  links?: Readonly<Record<string, string>>
  suiteDetails?: readonly StudioSuite[]
  profileDetails?: readonly StudioProfile[]
  secrets?: readonly StudioCredential[]
  readiness?: StudioRunReadiness
  policy: { adaptedResults: 'accept' | 'reject' }
}

export interface StudioPlanEvidence {
  testRunId: string
  result?: TestResult
}

export interface StudioPlanReview {
  scenario: { id: string; name: string }
  executionTargetProfileId: string
  approved?: ExecutionPlan
  candidate?: CandidateExecutionPlan
  candidateRevision?: string
  evidence?: StudioPlanEvidence
}

export interface StudioPlanPromotionRequest {
  scenarioId: string
  executionTargetProfileId: string
  expectedCandidateRevision: string
}

export interface StudioPlanGateway {
  list(): Promise<readonly StudioPlanReview[]>
  promote(input: StudioPlanPromotionRequest): Promise<ExecutionPlan>
}

export interface StudioRunRequest {
  suite?: string
  profiles?: readonly string[]
  paths?: readonly string[]
  scenarioName?: string
  scenarioId?: string
  rerunId?: string
  failures?: boolean
  adaptations?: boolean
}

export interface StudioRunSnapshot {
  id: string
  events: RunEvent[]
  manifest?: TestRunManifest
}

export interface StudioRunGateway {
  start(
    request: StudioRunRequest | undefined,
    onEvent: (event: RunEvent) => void,
  ): Promise<{ id: string; done: Promise<unknown> }>
  snapshot(id: string): Promise<StudioRunSnapshot>
  cancel(id: string): Promise<void>
}

export interface StudioHistoryGateway {
  list(): Promise<StudioHistory>
  compare(
    baselineRunId: string,
    candidateRunId: string,
  ): Promise<TestRunComparison>
  importArchive(bytes: Uint8Array): Promise<TestRunManifest>
  exportArchive(runId: string): Promise<string>
  exportHtml(runId: string, artifacts: HtmlArtifactMode): Promise<string>
  deleteEligible(): Promise<{ removed: string[] }>
}

export interface StudioRetentionPolicy {
  maxAgeMs: number
  maxBytes: number
}

export interface StudioHistory {
  runs: readonly TestRunSummary[]
  retention: StudioRetentionPolicy
}

export interface StudioAuthoringGateway {
  model: StudioAuthoringModel
  propose?: (input: {
    prompt: string
    currentSource?: string
  }) => Promise<{ source: string }>
}

export interface StudioManagementGateway {
  saveConfig(patch: StudioConfigPatch): Promise<StudioProject>
  saveCredential(input: {
    name: string
    secret: string
  }): Promise<StudioProject>
  readiness(request?: StudioRunRequest): Promise<StudioRunReadiness>
}

export interface StudioOptions {
  project: StudioProject
  loadProject?: () => Promise<StudioProject> | StudioProject
  gateway?: StudioRunGateway
  history?: StudioHistoryGateway
  documents?: SpecificationWorkspace
  authoring?: StudioAuthoringGateway
  management?: StudioManagementGateway
  plans?: StudioPlanGateway
  git?: GitWorkspace
  specificationGlobs?: string | readonly string[]
  language?: string
  hostname?: string
  allowRemoteAccess?: boolean
  port?: number
  token?: string
  open?: boolean
}

export interface StudioServer {
  url: string
  token: string
  stop(): void
}

type HtmlAsset = {
  index: string
  files: Map<string, Blob>
  outdir: string
}

type StudioStreamEvent =
  | RunEvent
  | { type: 'run-finished'; run: { id: string } }

type WorkspaceStreamEvent = DiskChangeEvent & { type: 'disk-changed' }

type StudioSocketData =
  | {
      kind: 'run'
      runId: string
      listener?: (event: StudioStreamEvent) => void
    }
  | {
      kind: 'workspace'
      listener?: (event: WorkspaceStreamEvent) => void
    }

type CredentialWriteRequest = {
  name?: string
  secret?: string
}

type HistoryComparisonRequest = {
  baselineRunId?: string
  candidateRunId?: string
}

type GitPathsRequest = {
  paths?: string[]
}

type GitCommitRequest = {
  message?: string
  confirmed?: boolean
  paths?: string[]
}

type DocumentPreviewRequest = {
  uri: string
  source: string
  specification?: StructuredSpecification
  metadata?: SpecificationMetadata
  diffAgainst?: string
}

type DocumentWriteRequest = {
  uri: string
  source: string
  expectedRevision?: string
  create?: boolean
}

type DocumentProposeRequest = {
  prompt: string
  uri?: string
  currentSource?: string
}

type PlanPromotionRequest = Partial<StudioPlanPromotionRequest> & {
  confirmed?: boolean
}

const sessionCookie = 'pickle_studio_token'
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])

const htmlEntry = join(import.meta.dir, 'index.html')

function browserHostname(hostname: string): string {
  return hostname.includes(':') ? `[${hostname}]` : hostname
}

function secureResponse(response: Response, origin: string): Response {
  const websocketOrigin = origin.replace(/^http/, 'ws')
  response.headers.set('cache-control', 'no-store')
  response.headers.set(
    'content-security-policy',
    [
      "default-src 'none'",
      "base-uri 'none'",
      `connect-src 'self' ${websocketOrigin}`,
      "font-src 'self' data:",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob:",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
    ].join('; '),
  )
  response.headers.set('referrer-policy', 'no-referrer')
  response.headers.set('x-content-type-options', 'nosniff')
  return response
}

async function buildUi(): Promise<HtmlAsset> {
  const outdir = await mkdtemp(join(tmpdir(), 'pickle-studio-ui-'))
  const result = await Bun.build({
    entrypoints: [htmlEntry],
    outdir,
    target: 'browser',
    plugins: [tailwind],
  })
  if (!result.success) {
    await rm(outdir, { recursive: true, force: true })
    throw new Error('Studio UI failed to build')
  }
  const files = new Map<string, Blob>()
  for (const output of result.outputs) {
    const name = basename(output.path)
    files.set(name, output)
    files.set(`/${name}`, output)
  }
  const index = files.get('index.html')
  if (!index) {
    await rm(outdir, { recursive: true, force: true })
    throw new Error('Studio UI build did not produce index.html')
  }
  return { index: await index.text(), files, outdir }
}

function requestToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization')
  if (authorization?.startsWith('Bearer ')) {
    const bearerToken = authorization.slice(7)
    if (bearerToken) return bearerToken
  }
  const query = new URL(request.url).searchParams.get('token')
  if (query) return query
  const cookie = request.headers.get('cookie')
  if (!cookie) return undefined
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === sessionCookie) return decodeURIComponent(rest.join('='))
  }
}

function openBrowser(url: string): void {
  if (process.platform === 'darwin') {
    Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' })
    return
  }
  if (process.platform === 'win32') {
    Bun.spawn(['cmd', '/c', 'start', '', url], {
      stdout: 'ignore',
      stderr: 'ignore',
    })
    return
  }
  Bun.spawn(['xdg-open', url], { stdout: 'ignore', stderr: 'ignore' })
}

export async function startStudio(
  options: StudioOptions,
): Promise<StudioServer> {
  const hostname = options.hostname ?? '127.0.0.1'
  const remote = !loopbackHosts.has(hostname)
  if (remote && !options.allowRemoteAccess) {
    throw new Error(
      `Studio refuses to bind to ${hostname} without explicit remote access`,
    )
  }
  if (remote) {
    console.warn(
      `Remote Studio access is enabled on ${hostname}. The session token grants access to local project data; use a trusted network.`,
    )
  }
  const token = options.token ?? crypto.randomUUID()
  const ui = await buildUi()
  const documents =
    options.documents ??
    createSpecificationWorkspace({
      root: options.project.root,
      globs: options.specificationGlobs ?? 'features/**/*.feature',
      language: options.language,
    })
  const git = options.git ?? createGitWorkspace(options.project.root)
  const listeners = new Map<string, Set<(event: StudioStreamEvent) => void>>()
  const buffers = new Map<string, StudioStreamEvent[]>()
  const workspaceListeners = new Set<(event: WorkspaceStreamEvent) => void>()
  const activeRuns = new Set<string>()

  function publish(id: string, event: StudioStreamEvent): void {
    if (!id) return
    const events = buffers.get(id) ?? []
    events.push(event)
    buffers.set(id, events)
    for (const listener of listeners.get(id) ?? []) listener(event)
  }

  function authorized(request: Request, origin: string): boolean {
    if (requestToken(request) !== token) return false
    const header = request.headers.get('origin')
    return !header || header === origin
  }

  async function currentProject(): Promise<StudioProject> {
    const project = options.loadProject
      ? await options.loadProject()
      : options.project
    return {
      ...project,
      model: options.authoring?.model ?? project.model,
    }
  }

  function conflictResponse(error: DocumentConflictError, source: string) {
    return Response.json(
      {
        code: error.code,
        uri: error.uri,
        diskSource: error.diskSource,
        revision: error.revision,
        diff: specificationSourceDiff(source, error.diskSource),
      },
      { status: 409 },
    )
  }

  const stopWatch = await documents.watch((event) => {
    const payload: WorkspaceStreamEvent = { type: 'disk-changed', ...event }
    for (const listener of workspaceListeners) listener(payload)
  })

  const server = Bun.serve<StudioSocketData>({
    hostname,
    port: options.port ?? 0,
    websocket: {
      open(ws) {
        if (ws.data.kind === 'workspace') {
          const listener = (event: WorkspaceStreamEvent) => {
            ws.send(JSON.stringify(event))
          }
          workspaceListeners.add(listener)
          ws.data = { kind: 'workspace', listener }
          return
        }
        const runId = ws.data.runId
        for (const event of buffers.get(runId) ?? []) {
          ws.send(JSON.stringify(event))
        }
        const listener = (event: StudioStreamEvent) => {
          ws.send(JSON.stringify(event))
        }
        const set = listeners.get(runId) ?? new Set()
        set.add(listener)
        listeners.set(runId, set)
        ws.data = { kind: 'run', runId, listener }
      },
      message() {},
      close(ws) {
        if (ws.data.kind === 'workspace') {
          if (ws.data.listener) workspaceListeners.delete(ws.data.listener)
          return
        }
        if (!ws.data.listener) return
        listeners.get(ws.data.runId)?.delete(ws.data.listener)
      },
    },
    async fetch(request, server) {
      const url = new URL(request.url)
      const origin = `http://${browserHostname(hostname)}:${server.port}`
      async function routeHistory(): Promise<Response | null> {
        if (url.pathname === '/api/history' && request.method === 'GET') {
          if (!options.history) {
            return new Response('Test run history is unavailable', {
              status: 501,
            })
          }
          return Response.json(await options.history.list())
        }
        if (
          url.pathname === '/api/history/compare' &&
          request.method === 'POST'
        ) {
          if (!options.history) {
            return new Response('Test run history is unavailable', {
              status: 501,
            })
          }
          const body = (await request.json()) as HistoryComparisonRequest
          if (!body.baselineRunId || !body.candidateRunId) {
            return new Response('Select two test runs to compare', {
              status: 400,
            })
          }
          return Response.json(
            await options.history.compare(
              body.baselineRunId,
              body.candidateRunId,
            ),
          )
        }
        if (
          url.pathname === '/api/history/import' &&
          request.method === 'POST'
        ) {
          if (!options.history) {
            return new Response('Test run history is unavailable', {
              status: 501,
            })
          }
          try {
            return Response.json(
              await options.history.importArchive(
                new Uint8Array(await request.arrayBuffer()),
              ),
            )
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            return new Response(message, { status: 400 })
          }
        }
        if (
          url.pathname === '/api/history/retention' &&
          request.method === 'POST'
        ) {
          if (!options.history) {
            return new Response('Test run history is unavailable', {
              status: 501,
            })
          }
          return Response.json(await options.history.deleteEligible())
        }
        const historyExportMatch = url.pathname.match(
          /^\/api\/history\/([^/]+)\/(html|archive)$/,
        )
        if (historyExportMatch && request.method === 'GET') {
          if (!options.history) {
            return new Response('Test run history is unavailable', {
              status: 501,
            })
          }
          const runId = decodeURIComponent(historyExportMatch[1]!)
          const kind = historyExportMatch[2]
          if (kind === 'archive') {
            return new Response(await options.history.exportArchive(runId), {
              headers: {
                'content-type': 'application/json; charset=utf-8',
                'content-disposition': `attachment; filename="${runId}.pickle-run.json"`,
              },
            })
          }
          const artifacts =
            url.searchParams.get('artifacts') === 'all'
              ? 'all'
              : 'failures-and-adaptations'
          return new Response(
            await options.history.exportHtml(runId, artifacts),
            {
              headers: {
                'content-type': 'text/html; charset=utf-8',
                'content-disposition': `attachment; filename="${runId}.html"`,
              },
            },
          )
        }
        return null
      }

      async function routePlans(): Promise<Response | null> {
        if (url.pathname === '/api/plans' && request.method === 'GET') {
          if (!options.plans) {
            return new Response('Execution plans are unavailable', {
              status: 501,
            })
          }
          return Response.json(await options.plans.list())
        }
        if (
          url.pathname === '/api/plans/promote' &&
          request.method === 'POST'
        ) {
          if (!options.plans) {
            return new Response('Execution plans are unavailable', {
              status: 501,
            })
          }
          const body = (await request.json()) as PlanPromotionRequest
          if (body.confirmed !== true) {
            return new Response(
              'Plan promotion requires explicit confirmation',
              {
                status: 400,
              },
            )
          }
          if (activeRuns.size > 0) {
            return new Response(
              'A candidate plan cannot be promoted during a test run',
              { status: 409 },
            )
          }
          if (
            !body.scenarioId ||
            !body.executionTargetProfileId ||
            !body.expectedCandidateRevision
          ) {
            return new Response('Plan promotion request is incomplete', {
              status: 400,
            })
          }
          try {
            return Response.json(
              await options.plans.promote({
                scenarioId: body.scenarioId,
                executionTargetProfileId: body.executionTargetProfileId,
                expectedCandidateRevision: body.expectedCandidateRevision,
              }),
            )
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            return new Response(message, { status: 409 })
          }
        }
        return null
      }

      async function routeManagement(): Promise<Response | null> {
        if (url.pathname === '/api/config' && request.method === 'PUT') {
          if (!options.management) {
            return new Response('Project configuration is unavailable', {
              status: 501,
            })
          }
          try {
            const patch = (await request.json()) as StudioConfigPatch
            return Response.json(await options.management.saveConfig(patch))
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            return new Response(message, { status: 400 })
          }
        }
        if (url.pathname === '/api/credentials' && request.method === 'PUT') {
          if (!options.management) {
            return new Response('Credentials are unavailable', { status: 501 })
          }
          try {
            const body = (await request.json()) as CredentialWriteRequest
            return Response.json(
              await options.management.saveCredential({
                name: body.name ?? '',
                secret: body.secret ?? '',
              }),
            )
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            return new Response(message, { status: 400 })
          }
        }
        if (
          url.pathname === '/api/run-readiness' &&
          request.method === 'POST'
        ) {
          if (!options.management) {
            return Response.json(
              (await currentProject()).readiness ?? {
                ready: true,
                reasons: [],
              },
            )
          }
          const body = (await request
            .json()
            .catch(() => ({}))) as StudioRunRequest
          return Response.json(await options.management.readiness(body))
        }
        if (url.pathname === '/api/git' && request.method === 'GET') {
          return Response.json(await git.status())
        }
        if (url.pathname === '/api/git/stage' && request.method === 'POST') {
          const body = (await request.json()) as GitPathsRequest
          try {
            return Response.json(await git.stage(body.paths ?? []))
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            return new Response(message, { status: 400 })
          }
        }
        if (url.pathname === '/api/git/commit' && request.method === 'POST') {
          const body = (await request.json()) as GitCommitRequest
          try {
            return Response.json(
              await git.commit({
                message: body.message ?? '',
                confirmed: Boolean(body.confirmed),
                paths: body.paths ?? [],
              }),
            )
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            return new Response(message, { status: 400 })
          }
        }
        if (
          url.pathname === '/api/git/pull-request' &&
          request.method === 'POST'
        ) {
          try {
            return Response.json(await git.pullRequest())
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            return new Response(message, { status: 400 })
          }
        }
        return null
      }

      async function routeDocuments(): Promise<Response | null> {
        if (url.pathname === '/api/documents' && request.method === 'GET') {
          const uri = url.searchParams.get('uri')
          if (!uri) return new Response('Missing uri', { status: 400 })
          try {
            return Response.json(await documents.read(uri))
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            return new Response(message, { status: 404 })
          }
        }
        if (
          url.pathname === '/api/documents/completions' &&
          request.method === 'GET'
        ) {
          return Response.json(await documents.completions())
        }
        if (
          url.pathname === '/api/documents/preview' &&
          request.method === 'POST'
        ) {
          const body = (await request.json()) as DocumentPreviewRequest
          try {
            return Response.json(
              documents.preview({
                uri: body.uri,
                source: body.source,
                specification: body.specification,
                metadata: body.metadata,
                diffAgainst: body.diffAgainst,
              }),
            )
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            return new Response(message, { status: 400 })
          }
        }
        if (url.pathname === '/api/documents' && request.method === 'PUT') {
          const body = (await request.json()) as DocumentWriteRequest
          try {
            return Response.json(
              await documents.write({
                uri: body.uri,
                source: body.source,
                expectedRevision: body.expectedRevision,
                create: body.create,
              }),
            )
          } catch (error) {
            if (error instanceof DocumentConflictError) {
              return conflictResponse(error, body.source)
            }
            const message =
              error instanceof Error ? error.message : String(error)
            return new Response(message, { status: 400 })
          }
        }
        if (
          url.pathname === '/api/documents/propose' &&
          request.method === 'POST'
        ) {
          if (!options.authoring?.propose) {
            return new Response('AI assistance is unavailable', { status: 501 })
          }
          const body = (await request.json()) as DocumentProposeRequest
          try {
            return Response.json(
              await documents.propose({
                prompt: body.prompt,
                uri: body.uri,
                currentSource: body.currentSource,
                author: options.authoring.propose,
              }),
            )
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            return new Response(message, { status: 400 })
          }
        }
        return null
      }

      async function routeExecution(): Promise<Response | undefined> {
        if (
          url.pathname === '/api/workspace/events' &&
          request.method === 'GET'
        ) {
          const upgraded = server.upgrade(request, {
            data: { kind: 'workspace' },
          })
          if (upgraded) return
          return new Response('WebSocket upgrade failed', { status: 400 })
        }
        if (url.pathname === '/api/runs' && request.method === 'POST') {
          if (!options.gateway) {
            return new Response('Test runs are unavailable', { status: 501 })
          }
          const body = (await request
            .json()
            .catch(() => ({}))) as StudioRunRequest
          let runId = ''
          try {
            const started = await options.gateway.start(body, (event) => {
              if (event.type === 'run-started') runId = event.run.id
              publish(runId, event)
            })
            runId = started.id
            activeRuns.add(started.id)
            const finishRun = () => {
              publish(runId, { type: 'run-finished', run: { id: runId } })
            }
            void started.done
              .then(finishRun, finishRun)
              .finally(() => activeRuns.delete(started.id))
            return Response.json({ id: started.id })
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            return new Response(message, { status: 500 })
          }
        }
        if (url.pathname === '/api/artifact' && request.method === 'GET') {
          const filePath = url.searchParams.get('path')
          if (!filePath) return new Response('Missing path', { status: 400 })
          const resolved = resolve(filePath)
          const allowed = resolve(options.project.root, '.pickle', 'runs')
          if (resolved !== allowed && !resolved.startsWith(`${allowed}/`)) {
            return new Response('Forbidden', { status: 403 })
          }
          const file = Bun.file(resolved)
          if (!(await file.exists()))
            return new Response('Not found', { status: 404 })
          return new Response(file)
        }
        const cancelMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/)
        if (cancelMatch && request.method === 'POST') {
          if (!options.gateway) {
            return new Response('Test runs are unavailable', { status: 501 })
          }
          await options.gateway.cancel(decodeURIComponent(cancelMatch[1]!))
          return new Response(null, { status: 204 })
        }
        const eventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/)
        if (eventsMatch && request.method === 'GET') {
          const runId = decodeURIComponent(eventsMatch[1]!)
          const upgraded = server.upgrade(request, {
            data: { kind: 'run', runId },
          })
          if (upgraded) return
          return new Response('WebSocket upgrade failed', { status: 400 })
        }
        const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/)
        if (runMatch && request.method === 'GET') {
          if (!options.gateway) {
            return new Response('Test runs are unavailable', { status: 501 })
          }
          return Response.json(
            await options.gateway.snapshot(decodeURIComponent(runMatch[1]!)),
          )
        }
        return new Response('Not found', { status: 404 })
      }

      async function routeRequest(): Promise<Response | undefined> {
        if (url.pathname === '/' || url.pathname === '/index.html') {
          if (!authorized(request, origin)) {
            return new Response('Unauthorized', { status: 401 })
          }
          return new Response(ui.index, {
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'set-cookie': `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`,
            },
          })
        }
        const asset =
          ui.files.get(url.pathname) ?? ui.files.get(basename(url.pathname))
        if (asset && request.method === 'GET') {
          if (!authorized(request, origin)) {
            return new Response('Unauthorized', { status: 401 })
          }
          return new Response(asset)
        }
        if (!authorized(request, origin)) {
          return new Response('Unauthorized', { status: 401 })
        }
        if (url.pathname === '/api/project' && request.method === 'GET') {
          return Response.json(await currentProject())
        }
        const historyResponse = await routeHistory()
        if (historyResponse) return historyResponse
        const planResponse = await routePlans()
        if (planResponse) return planResponse
        const managementResponse = await routeManagement()
        if (managementResponse) return managementResponse
        const documentResponse = await routeDocuments()
        if (documentResponse) return documentResponse
        return routeExecution()
      }
      const response = await routeRequest()
      return response ? secureResponse(response, origin) : undefined
    },
  })

  const url = `http://${browserHostname(hostname)}:${server.port}/?token=${token}`
  if (options.open) openBrowser(url)

  return {
    url,
    token,
    stop() {
      stopWatch()
      server.stop(true)
      void rm(ui.outdir, { recursive: true, force: true })
    },
  }
}
