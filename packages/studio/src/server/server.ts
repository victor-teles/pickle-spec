import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type {
  DiagnosticEntry,
  ExecutionCacheEntryMetadata,
  HtmlArtifactMode,
  RunEvent,
  ScheduledTestResult,
  TestRunComparison,
  TestRunManifest,
  TestRunStorageInspection,
  TestRunSummary,
} from '@pickle-spec/runner'
import type {
  SpecificationMetadata,
  StructuredSpecification,
} from '@pickle-spec/spec'
import { specificationSourceDiff } from '@pickle-spec/spec'
import tailwind from 'bun-plugin-tailwind'
import { parseStudioRoute } from '../app/studio-route'
import {
  createSpecificationWorkspace,
  type DiskChangeEvent,
  DocumentConflictError,
  type SpecificationWorkspace,
} from '../authoring/documents'
import { requiredValue } from '../required-value'
import { createGitWorkspace, type GitWorkspace } from './git'
import { resolveStudioArtifactPath } from './studio-artifact-path'

export interface StudioScenario {
  id: string
  name: string
  canRun?: boolean
  readiness?: StudioRunReadiness
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
  mobile?: StudioMobileProfile
}

export interface StudioMobileProfile {
  executionTarget: 'android-emulator' | 'ios-simulator'
  application: {
    id: string
    binaryPath: string
  }
  targetId?: string
  artifactDirectory?: string
  artifacts?: readonly ('screenshot' | 'trace' | 'recording' | 'device-log')[]
  redactions?: readonly { match: string; replacement?: string }[]
  nodePath?: string
}

export interface StudioMobileTarget {
  id: string
  name: string
  state: 'booted' | 'offline'
  capabilities: readonly string[]
}

export interface StudioMobileTargetDiscovery {
  profileId: string
  executionTarget: 'android-emulator' | 'ios-simulator'
  targets: readonly StudioMobileTarget[]
  error?: string
}

export interface StudioCredential {
  name: string
  present: boolean
}

export type StudioRunReadinessCheckId =
  | 'selection'
  | 'execution-target'
  | 'model-credential'
  | 'mobile-target'

export type StudioRunReadinessCheck =
  | {
      id: StudioRunReadinessCheckId
      status: 'ready'
    }
  | {
      id: StudioRunReadinessCheckId
      status: 'not-applicable'
    }
  | {
      id: StudioRunReadinessCheckId
      status: 'blocked'
      reasons: readonly [string, ...string[]]
    }

export interface StudioRunReadiness {
  ready: boolean
  reasons: readonly string[]
  checks?: readonly StudioRunReadinessCheck[]
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
    {
      adapter: string
      capabilities?: readonly string[]
      mobile?: StudioMobileProfile
    }
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
}

export interface StudioRunRequest {
  suite?: string
  profiles?: readonly string[]
  paths?: readonly string[]
  scenarioName?: string
  scenarioId?: string
  rerunId?: string
  failures?: boolean
  refreshCache?: boolean
}

export interface StudioRunSnapshot {
  id: string
  events: RunEvent[]
  manifest?: TestRunManifest
  schedule?: readonly ScheduledTestResult[]
}

export type StudioLiveDiagnosticEvent = {
  type: 'diagnostic-recorded'
  profileId: string
  scope?: Extract<RunEvent, { type: 'scenario-started' }>['scope']
  diagnostic: DiagnosticEntry
}

export type StudioRunStreamEvent =
  | RunEvent
  | StudioLiveDiagnosticEvent
  | { type: 'run-scheduled'; schedule: readonly ScheduledTestResult[] }
  | { type: 'run-finished'; run: { id: string } }

export interface StudioRunGateway {
  start(
    request: StudioRunRequest | undefined,
    onEvent: (event: StudioRunStreamEvent) => void,
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
  exportAllure(runId: string): Promise<Uint8Array>
  deleteEligible(): Promise<{
    removed: string[]
    beforeBytes: number
    afterBytes: number
  }>
  pin(runId: string): Promise<void>
  unpin(runId: string): Promise<void>
}

export interface StudioRetentionPolicy {
  maxAgeMs?: number
  maxBytes?: number
}

export interface StudioHistory {
  runs: readonly TestRunSummary[]
  retention: StudioRetentionPolicy
  storage: TestRunStorageInspection
}

export interface StudioRunsIndex extends StudioHistory {
  activeRunIds: readonly string[]
}

export interface StudioExecutionCacheInspection {
  projectKey: string
  maxBytes: number
  entries: readonly ExecutionCacheEntryMetadata[]
}

export interface StudioExecutionCacheGateway {
  inspect(): Promise<StudioExecutionCacheInspection>
  clear(): Promise<{ clearedEntries: number }>
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
  discoverMobileTargets?(): Promise<readonly StudioMobileTargetDiscovery[]>
}

export interface StudioOptions {
  project: StudioProject
  loadProject?: () => Promise<StudioProject> | StudioProject
  gateway?: StudioRunGateway
  history?: StudioHistoryGateway
  documents?: SpecificationWorkspace
  authoring?: StudioAuthoringGateway
  management?: StudioManagementGateway
  executionCache?: StudioExecutionCacheGateway
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
}

type StudioStreamEvent = StudioRunStreamEvent

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

const sessionCookie = 'pickle_studio_token'
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])

const htmlEntry = join(import.meta.dir, '../index.html')

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
      "media-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
    ].join('; '),
  )
  response.headers.set('referrer-policy', 'no-referrer')
  response.headers.set('x-content-type-options', 'nosniff')
  return response
}

let uiBuild: Promise<HtmlAsset> | undefined

async function compileUi(): Promise<HtmlAsset> {
  const outdir = await mkdtemp(join(tmpdir(), 'pickle-studio-ui-'))
  try {
    const result = await Bun.build({
      entrypoints: [htmlEntry],
      outdir,
      target: 'browser',
      plugins: [tailwind],
    })
    if (!result.success) throw new Error('Studio UI failed to build')
    const files = new Map<string, Blob>()
    for (const output of result.outputs) {
      const name = basename(output.path)
      const blob = new Blob([await output.arrayBuffer()], { type: output.type })
      files.set(name, blob)
      files.set(`/${name}`, blob)
    }
    const index = files.get('index.html')
    if (!index) throw new Error('Studio UI build did not produce index.html')
    return { index: await index.text(), files }
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

function buildUi(): Promise<HtmlAsset> {
  uiBuild ??= compileUi().catch((error: unknown) => {
    uiBuild = undefined
    throw error
  })
  return uiBuild
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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Studio startup owns one server lifecycle and its private route closures
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
        const socket = ws
        if (socket.data.kind === 'workspace') {
          const listener = (event: WorkspaceStreamEvent) => {
            ws.send(JSON.stringify(event))
          }
          workspaceListeners.add(listener)
          socket.data = { kind: 'workspace', listener }
          return
        }
        const runId = socket.data.runId
        for (const event of buffers.get(runId) ?? []) {
          ws.send(JSON.stringify(event))
        }
        const listener = (event: StudioStreamEvent) => {
          ws.send(JSON.stringify(event))
        }
        const set = listeners.get(runId) ?? new Set()
        set.add(listener)
        listeners.set(runId, set)
        socket.data = { kind: 'run', runId, listener }
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
    // biome-ignore lint/complexity/noExcessiveLinesPerFunction: the fetch callback is a route composition root built from focused endpoint handlers
    async fetch(request, localServer) {
      const url = new URL(request.url)
      const origin = `http://${browserHostname(hostname)}:${localServer.port}`
      const requestKey = `${request.method} ${url.pathname}`

      function historyUnavailable(): Response {
        return new Response('Test run history is unavailable', { status: 501 })
      }

      function requestError(error: unknown, status = 400): Response {
        const message = error instanceof Error ? error.message : String(error)
        return new Response(message, { status })
      }

      async function historyIndex(): Promise<Response> {
        if (!options.history) return historyUnavailable()
        return Response.json({
          ...(await options.history.list()),
          activeRunIds: [...activeRuns].sort(),
        } satisfies StudioRunsIndex)
      }

      async function compareHistory(): Promise<Response> {
        if (!options.history) return historyUnavailable()
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

      async function importHistory(): Promise<Response> {
        if (!options.history) return historyUnavailable()
        try {
          const archive = new Uint8Array(await request.arrayBuffer())
          return Response.json(await options.history.importArchive(archive))
        } catch (error) {
          return requestError(error)
        }
      }

      async function deleteHistoryEligible(): Promise<Response> {
        return options.history
          ? Response.json(await options.history.deleteEligible())
          : historyUnavailable()
      }

      async function pinHistory(match: RegExpMatchArray): Promise<Response> {
        if (!options.history) return historyUnavailable()
        const runId = decodeURIComponent(requiredValue(match[1]))
        if (request.method === 'POST') await options.history.pin(runId)
        else await options.history.unpin(runId)
        return Response.json({ runId, pinned: request.method === 'POST' })
      }

      async function exportHistory(match: RegExpMatchArray): Promise<Response> {
        if (!options.history) return historyUnavailable()
        const runId = decodeURIComponent(requiredValue(match[1]))
        const kind = match[2]
        const exporters: Record<string, () => Promise<Response>> = {
          archive: async () =>
            new Response(
              await requiredValue(options.history).exportArchive(runId),
              {
                headers: {
                  'content-type': 'application/json; charset=utf-8',
                  'content-disposition': `attachment; filename="${runId}.pickle-run.json"`,
                },
              },
            ),
          allure: async () => {
            const bytes = await requiredValue(options.history).exportAllure(
              runId,
            )
            return new Response(bytes.buffer as ArrayBuffer, {
              headers: {
                'content-type': 'application/zip',
                'content-disposition': `attachment; filename="${runId}-allure-results.zip"`,
              },
            })
          },
          html: async () => {
            const artifacts =
              url.searchParams.get('artifacts') === 'all' ? 'all' : 'failures'
            return new Response(
              await requiredValue(options.history).exportHtml(runId, artifacts),
              {
                headers: {
                  'content-type': 'text/html; charset=utf-8',
                  'content-disposition': `attachment; filename="${runId}.html"`,
                },
              },
            )
          },
        }
        const exporter = kind ? exporters[kind] : undefined
        return exporter?.() ?? new Response('Not found', { status: 404 })
      }

      async function dynamicHistoryRoute(): Promise<Response | null> {
        const pinMatch = url.pathname.match(/^\/api\/history\/([^/]+)\/pin$/)
        if (pinMatch && ['POST', 'DELETE'].includes(request.method)) {
          return pinHistory(pinMatch)
        }
        const exportMatch = url.pathname.match(
          /^\/api\/history\/([^/]+)\/(html|archive|allure)$/,
        )
        return exportMatch && request.method === 'GET'
          ? exportHistory(exportMatch)
          : null
      }

      async function routeHistory(): Promise<Response | null> {
        const exactRoutes: Record<string, () => Promise<Response>> = {
          'GET /api/history': historyIndex,
          'GET /api/runs': historyIndex,
          'POST /api/history/compare': compareHistory,
          'POST /api/history/import': importHistory,
          'POST /api/history/retention': deleteHistoryEligible,
        }
        const exact = exactRoutes[requestKey]
        return exact ? exact() : dynamicHistoryRoute()
      }

      async function executeCacheAction(
        action: () => Promise<unknown>,
      ): Promise<Response> {
        try {
          return Response.json(await action())
        } catch (error) {
          return requestError(error, 500)
        }
      }

      async function routeExecutionCache(): Promise<Response | null> {
        if (url.pathname !== '/api/execution-cache') return null
        if (!options.executionCache) {
          return new Response('Execution cache is unavailable', { status: 501 })
        }
        const actions: Record<string, () => Promise<unknown>> = {
          GET: () => requiredValue(options.executionCache).inspect(),
          DELETE: () => requiredValue(options.executionCache).clear(),
        }
        const action = actions[request.method]
        return action ? executeCacheAction(action) : null
      }

      async function saveProjectConfig(): Promise<Response> {
        if (!options.management) {
          return new Response('Project configuration is unavailable', {
            status: 501,
          })
        }
        try {
          const patch = (await request.json()) as StudioConfigPatch
          return Response.json(await options.management.saveConfig(patch))
        } catch (error) {
          return requestError(error)
        }
      }

      async function saveCredential(): Promise<Response> {
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
          return requestError(error)
        }
      }

      async function runReadiness(): Promise<Response> {
        if (!options.management) {
          return Response.json(
            (await currentProject()).readiness ?? { ready: true, reasons: [] },
          )
        }
        const body = (await request
          .json()
          .catch(() => ({}))) as StudioRunRequest
        return Response.json(await options.management.readiness(body))
      }

      async function mobileTargets(): Promise<Response> {
        if (!options.management?.discoverMobileTargets) {
          return new Response('Mobile target discovery is unavailable', {
            status: 501,
          })
        }
        return Response.json(await options.management.discoverMobileTargets())
      }

      async function stageGit(): Promise<Response> {
        const body = (await request.json()) as GitPathsRequest
        try {
          return Response.json(await git.stage(body.paths ?? []))
        } catch (error) {
          return requestError(error)
        }
      }

      async function commitGit(): Promise<Response> {
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
          return requestError(error)
        }
      }

      async function createPullRequest(): Promise<Response> {
        try {
          return Response.json(await git.pullRequest())
        } catch (error) {
          return requestError(error)
        }
      }

      async function routeManagement(): Promise<Response | null> {
        const routes: Record<string, () => Promise<Response>> = {
          'PUT /api/config': saveProjectConfig,
          'PUT /api/credentials': saveCredential,
          'POST /api/run-readiness': runReadiness,
          'GET /api/mobile-targets': mobileTargets,
          'GET /api/git': async () => Response.json(await git.status()),
          'POST /api/git/stage': stageGit,
          'POST /api/git/commit': commitGit,
          'POST /api/git/pull-request': createPullRequest,
        }
        return routes[requestKey]?.() ?? null
      }

      async function readDocument(): Promise<Response> {
        const uri = url.searchParams.get('uri')
        if (!uri) return new Response('Missing uri', { status: 400 })
        try {
          return Response.json(await documents.read(uri))
        } catch (error) {
          return requestError(error, 404)
        }
      }

      async function previewDocument(): Promise<Response> {
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
          return requestError(error)
        }
      }

      async function writeDocument(): Promise<Response> {
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
          return error instanceof DocumentConflictError
            ? conflictResponse(error, body.source)
            : requestError(error)
        }
      }

      async function proposeDocument(): Promise<Response> {
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
          return requestError(error)
        }
      }

      async function routeDocuments(): Promise<Response | null> {
        const routes: Record<string, () => Promise<Response>> = {
          'GET /api/documents': readDocument,
          'GET /api/documents/completions': async () =>
            Response.json(await documents.completions()),
          'POST /api/documents/preview': previewDocument,
          'PUT /api/documents': writeDocument,
          'POST /api/documents/propose': proposeDocument,
        }
        return routes[requestKey]?.() ?? null
      }

      function upgradeWorkspaceEvents(): Response | undefined {
        const upgraded = localServer.upgrade(request, {
          data: { kind: 'workspace' },
        })
        return upgraded
          ? undefined
          : new Response('WebSocket upgrade failed', { status: 400 })
      }

      function publishRunEvent(
        state: { runId: string; pending: StudioStreamEvent[] },
        event: StudioStreamEvent,
      ): void {
        const runState = state
        if (event.type === 'run-started') runState.runId = event.run.id
        if (!runState.runId) {
          runState.pending.push(event)
          return
        }
        for (const pendingEvent of runState.pending.splice(0)) {
          publish(runState.runId, pendingEvent)
        }
        publish(runState.runId, event)
      }

      async function startRun(): Promise<Response> {
        if (!options.gateway) {
          return new Response('Test runs are unavailable', { status: 501 })
        }
        const body = (await request
          .json()
          .catch(() => ({}))) as StudioRunRequest
        const state = { runId: '', pending: [] as StudioStreamEvent[] }
        try {
          const started = await options.gateway.start(body, (event) =>
            publishRunEvent(state, event),
          )
          state.runId = started.id
          for (const event of state.pending.splice(0))
            publish(state.runId, event)
          activeRuns.add(started.id)
          const finishRun = () => {
            publish(state.runId, {
              type: 'run-finished',
              run: { id: state.runId },
            })
          }
          void started.done
            .then(finishRun, finishRun)
            .finally(() => activeRuns.delete(started.id))
          return Response.json({ id: started.id })
        } catch (error) {
          return requestError(error, 500)
        }
      }

      function artifactPath(): string | Response {
        const resolved = resolveStudioArtifactPath(
          url.searchParams.get('path'),
          options.project.root,
        )
        if (resolved.kind === 'missing-query') {
          return new Response('Missing path', { status: 400 })
        }
        if (resolved.kind === 'forbidden') {
          return new Response('Forbidden', { status: 403 })
        }
        return resolved.path
      }

      function artifactResponse(
        path: string,
        file: ReturnType<typeof Bun.file>,
      ): Response {
        const headers = {
          'content-type': file.type || 'application/octet-stream',
          'content-length': String(file.size),
        }
        if (request.method === 'HEAD') return new Response(null, { headers })
        if (url.searchParams.get('download') !== 'true') {
          return new Response(file, { headers })
        }
        const requestedName = url.searchParams.get('name')
        const downloadName = basename(requestedName || path).replace(
          /["\r\n]/g,
          '_',
        )
        return new Response(file, {
          headers: {
            'content-disposition': `attachment; filename="${downloadName}"`,
          },
        })
      }

      async function readArtifact(): Promise<Response> {
        const path = artifactPath()
        if (path instanceof Response) return path
        const file = Bun.file(path)
        if (!(await file.exists()))
          return new Response('Not found', { status: 404 })
        return artifactResponse(path, file)
      }

      async function cancelRun(match: RegExpMatchArray): Promise<Response> {
        if (!options.gateway) {
          return new Response('Test runs are unavailable', { status: 501 })
        }
        await options.gateway.cancel(
          decodeURIComponent(requiredValue(match[1])),
        )
        return new Response(null, { status: 204 })
      }

      function upgradeRunEvents(match: RegExpMatchArray): Response | undefined {
        const runId = decodeURIComponent(requiredValue(match[1]))
        const upgraded = localServer.upgrade(request, {
          data: { kind: 'run', runId },
        })
        return upgraded
          ? undefined
          : new Response('WebSocket upgrade failed', { status: 400 })
      }

      async function runSnapshot(match: RegExpMatchArray): Promise<Response> {
        if (!options.gateway) {
          return new Response('Test runs are unavailable', { status: 501 })
        }
        const runId = decodeURIComponent(requiredValue(match[1]))
        const snapshot = await options.gateway.snapshot(runId)
        const scheduled = buffers
          .get(runId)
          ?.find((event) => event.type === 'run-scheduled')
        return Response.json({
          ...snapshot,
          schedule:
            scheduled?.type === 'run-scheduled'
              ? scheduled.schedule
              : undefined,
        } satisfies StudioRunSnapshot)
      }

      async function routeExecution(): Promise<Response | undefined> {
        const exactRoutes: Record<
          string,
          () => Response | undefined | Promise<Response>
        > = {
          'GET /api/workspace/events': upgradeWorkspaceEvents,
          'POST /api/runs': startRun,
          'GET /api/artifact': readArtifact,
          'HEAD /api/artifact': readArtifact,
        }
        const exact = exactRoutes[requestKey]
        if (exact) return exact()
        return routeRunResource()
      }

      async function routeRunResource(): Promise<Response | undefined> {
        const routes: Record<string, () => Promise<Response | undefined>> = {
          POST: postRunResource,
          GET: getRunResource,
        }
        return (
          routes[request.method]?.() ??
          new Response('Not found', { status: 404 })
        )
      }

      async function postRunResource(): Promise<Response> {
        const cancelMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/)
        return cancelMatch
          ? cancelRun(cancelMatch)
          : new Response('Not found', { status: 404 })
      }

      async function getRunResource(): Promise<Response | undefined> {
        const eventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/)
        if (eventsMatch) return upgradeRunEvents(eventsMatch)
        const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/)
        if (runMatch) return runSnapshot(runMatch)
        return new Response('Not found', { status: 404 })
      }

      function staticAsset(): Response | null {
        if (url.pathname === '/index.html') return null
        const asset =
          ui.files.get(url.pathname) ?? ui.files.get(basename(url.pathname))
        return asset && request.method === 'GET' ? new Response(asset) : null
      }

      function studioPage(): Response | null {
        if (request.method !== 'GET') return null
        const routeKind = parseStudioRoute(url.href).kind
        if (url.pathname !== '/index.html' && routeKind === 'not-found') {
          return null
        }
        return new Response(ui.index, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'set-cookie': `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`,
          },
        })
      }

      async function routeAuthenticatedApi(): Promise<Response | undefined> {
        if (requestKey === 'GET /api/project') {
          return Response.json(await currentProject())
        }
        const routes = [
          routeHistory,
          routeExecutionCache,
          routeManagement,
          routeDocuments,
        ]
        for (const route of routes) {
          const response = await route()
          if (response) return response
        }
        return routeExecution()
      }

      async function routeRequest(): Promise<Response | undefined> {
        const publicResponse = staticAsset() ?? studioPage()
        if (publicResponse) return authorizePublicResponse(publicResponse)
        if (!authorized(request, origin)) {
          return new Response('Unauthorized', { status: 401 })
        }
        return routeAuthenticatedApi()
      }

      function authorizePublicResponse(candidateResponse: Response): Response {
        return authorized(request, origin)
          ? candidateResponse
          : new Response('Unauthorized', { status: 401 })
      }
      const routedResponse = await routeRequest()
      return routedResponse ? secureResponse(routedResponse, origin) : undefined
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
    },
  }
}
