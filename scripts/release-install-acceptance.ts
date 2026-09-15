import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { validateReleasePackages } from './release-packages'

const nodeExecutable = Bun.which('node')
if (!nodeExecutable)
  throw new Error('Node.js 24 or newer is required for release acceptance')
const consumerEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: `${dirname(nodeExecutable)}:/usr/bin:/bin`,
}

const repositoryRoot = resolve(import.meta.dir, '..')

function assertAcceptance(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message)
}

function runCommand(command: string[], cwd: string, context: string): string {
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: command[0] === 'bun' ? process.env : consumerEnvironment,
  })
  assertAcceptance(
    result.exitCode === 0,
    `${context}: ${result.stdout.toString().trim()}\n${result.stderr.toString().trim()}`,
  )
  return result.stdout.toString()
}

async function packReleaseSet(root: string, artifactRoot: string) {
  runCommand(
    ['bun', 'run', 'build:packages'],
    root,
    'Release packages cannot be built',
  )
  const release = await validateReleasePackages(root)
  const artifacts = release.packages.map(({ directory, name }) => ({
    name,
    path: join(artifactRoot, `${basename(directory)}.tgz`),
  }))

  for (const [index, { directory, name }] of release.packages.entries()) {
    const artifact = artifacts[index]
    assertAcceptance(
      artifact !== undefined,
      `Missing artifact path for ${name}`,
    )
    runCommand(
      ['bun', 'pm', 'pack', '--filename', artifact.path, '--ignore-scripts'],
      join(root, directory),
      `${name} cannot be packed for installation`,
    )
  }
  return { artifacts, version: release.version }
}

async function installReleaseSet(
  projectRoot: string,
  artifacts: Awaited<ReturnType<typeof packReleaseSet>>['artifacts'],
): Promise<void> {
  const dependencies = Object.fromEntries(
    artifacts.map(({ name, path }) => [name, `file:${path}`]),
  )
  await Bun.write(
    join(projectRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'pickle-release-install-acceptance',
        private: true,
        dependencies,
        // Prepublication installs need overrides because packed internal
        // dependencies correctly refer to their final lockstep version.
        overrides: dependencies,
      },
      null,
      2,
    )}\n`,
  )
  runCommand(
    ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'],
    projectRoot,
    'Packed release set cannot be installed',
  )
}

async function verifyPackageImports(projectRoot: string): Promise<void> {
  const importPath = join(projectRoot, 'imports.mjs')
  await Bun.write(
    importPath,
    `await Promise.all([
  import('@pickle-spec/configuration'),
  import('@pickle-spec/spec'),
  import('@pickle-spec/spec/schemas'),
  import('@pickle-spec/runner'),
  import('@pickle-spec/runner/benchmarking'),
  import('@pickle-spec/runner/schemas'),
  import('@pickle-spec/runner/testing'),
  import('@pickle-spec/web'),
  import('@pickle-spec/mobile'),
  import('@pickle-spec/studio'),
  import('@pickle-spec/cli'),
])
`,
  )
  runCommand(['node', importPath], projectRoot, 'Packed package import failed')
}

async function verifyProjectRun(
  projectRoot: string,
  executable: string,
): Promise<void> {
  runCommand(
    [executable, 'init'],
    projectRoot,
    'Node CLI cannot initialize a project',
  )
  await Bun.write(join(projectRoot, '.env'), 'PICKLE_ACCEPTANCE_VALUE=loaded\n')
  await Bun.write(
    join(projectRoot, 'pickle.config.jsonc'),
    JSON.stringify({
      schemaVersion: 1,
      specifications: 'features/**/*.feature',
      executionTargetProfile: { id: 'node-acceptance' },
    }),
  )
  await Bun.write(
    join(projectRoot, 'features/node.feature'),
    `@pickle:id:specnodeacceptance @pickle:state:active
Feature: Node runtime
  @pickle:id:scnnodeacceptance
  Scenario: Load project environment
    Then the environment file is loaded
`,
  )
  await Bun.write(
    join(projectRoot, 'extension-values.ts'),
    `export enum EnvironmentValue { loaded = 'loaded' }`,
  )
  await Bun.write(
    join(projectRoot, 'pickle.extensions.ts'),
    `import type { ExecutionTargetAdapter } from '@pickle-spec/runner'
import { EnvironmentValue } from './extension-values'
export default {
  adapter: {
    async openSession() {
      return {
        async executeStep() {
          if (process.env.PICKLE_ACCEPTANCE_VALUE !== EnvironmentValue.loaded) throw new Error('Environment not loaded')
          return { state: 'passed', resolvedActions: [] }
        },
        async close() {},
      }
    },
  } satisfies ExecutionTargetAdapter,
}
`,
  )
  runCommand(
    [executable, 'check'],
    projectRoot,
    'Node CLI cannot validate a typed extension',
  )
  runCommand(
    [executable, 'run', '--output', 'json=node-run.json'],
    projectRoot,
    'Node CLI cannot execute a Specification',
  )
  const manifest = await Bun.file(join(projectRoot, 'node-run.json')).json()
  assertAcceptance(
    manifest.state === 'passed' && manifest.results.length === 1,
    'Node test run did not persist a passing result',
  )
}

async function verifyNodeCache(projectRoot: string): Promise<void> {
  const path = join(projectRoot, 'node-cache.mjs')
  await Bun.write(
    path,
    String.raw`import assert from 'node:assert/strict'
import { openLocalExecutionCache, serializeExecutionCacheEnvelope } from '@pickle-spec/runner'
const cache = await openLocalExecutionCache({ projectRoot: process.cwd() })
const key = {
  projectKey: cache.projectKey, scenarioId: 'node-cache-scenario', scenarioRevision: 'revision',
  executionTargetProfileId: 'node', targetConfigurationFingerprint: 'target',
  applicationRevision: 'application', adapterKind: 'node', adapterCacheSchemaVersion: '1',
}
const envelope = serializeExecutionCacheEnvelope({ schemaVersion: 1, key, requiredVariables: [], adapterPayload: ['step'] }, {
  adapterKind: 'node', adapterCacheSchemaVersion: '1', parse: (value) => value, prefixStepCount: () => 1,
})
const acquired = await cache.coordination.acquire(key)
assert.equal(acquired.acquired, true)
const published = await cache.coordination.publish(acquired.lease, envelope, { sourceRunId: 'node-run', evaluationInferenceCount: 1 })
assert.equal(published.published, true)
assert.equal(await cache.read(key), envelope.source)
const reopened = await openLocalExecutionCache({ projectRoot: process.cwd() })
assert.equal(await reopened.read(key), envelope.source)
await reopened.delete(key)
assert.equal(await reopened.read(key), undefined)
`,
  )
  runCommand(
    ['node', path],
    projectRoot,
    'Node SQLite cache cannot publish, reopen, and delete an entry',
  )
}

async function verifyNodeWorker(projectRoot: string): Promise<void> {
  const path = join(projectRoot, 'node-worker.mjs')
  await Bun.write(
    path,
    String.raw`import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
const entry = new URL('./src/worker/worker.js', import.meta.resolve('@pickle-spec/mobile'))
const worker = spawn(process.execPath, [fileURLToPath(entry)], { stdio: ['pipe', 'pipe', 'inherit'] })
const timeout = setTimeout(() => worker.kill('SIGKILL'), 10000)
const exited = once(worker, 'close')
try {
  const lines = createInterface({ input: worker.stdout })
  const [line] = await once(lines, 'line')
  const ready = JSON.parse(line)
  assert.equal(ready.type, 'worker-ready')
  assert.equal(ready.nodeVersion, process.versions.node)
  worker.stdin.end()
  const [code] = await exited
  assert.equal(code, 0)
} finally {
  clearTimeout(timeout)
  worker.kill()
}
`,
  )
  runCommand(
    ['node', path],
    projectRoot,
    'Packed mobile worker cannot start and shut down on Node',
  )
}

function emptyRunArchive(id: string) {
  const startedAt = '2026-09-14T12:00:00.000Z'
  return {
    schemaVersion: 2,
    kind: 'run-archive',
    manifest: {
      schemaVersion: 2,
      id,
      startedAt,
      finishedAt: '2026-09-14T12:00:01.000Z',
      state: 'passed',
      results: [],
    },
    events: [
      {
        schemaVersion: 2,
        sequence: 1,
        occurredAt: startedAt,
        type: 'run-started',
        run: { id, startedAt },
      },
    ],
    artifacts: [],
  }
}

async function verifyArchiveHandoff(
  projectRoot: string,
  pickleExecutable: string,
): Promise<void> {
  const runId = 'run-release-install-acceptance'
  const incoming = join(projectRoot, 'incoming.archive.json')
  const outgoing = join(projectRoot, 'outgoing.archive.json')
  await Bun.write(incoming, `${JSON.stringify(emptyRunArchive(runId))}\n`)

  runCommand(
    [pickleExecutable, 'import', incoming],
    projectRoot,
    'Packed CLI cannot import a previous-schema archive',
  )
  runCommand(
    [pickleExecutable, 'export', runId, '--output', `archive=${outgoing}`],
    projectRoot,
    'Packed CLI cannot export an imported run',
  )

  const receivingRoot = join(projectRoot, 'receiving-project')
  await mkdir(receivingRoot)
  const output = runCommand(
    [pickleExecutable, 'import', outgoing],
    receivingRoot,
    'Packed CLI cannot hand an archive to an isolated project',
  )
  assertAcceptance(
    output.includes(`"id":"${runId}"`),
    'Archive handoff did not preserve the run identifier',
  )
}

async function studioUrl(stdout: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let output = ''
  for await (const chunk of stdout) {
    output += decoder.decode(chunk, { stream: true })
    const match = output.match(/(?:^|\n)Studio (http:\/\/[^\s]+)/)
    if (match?.[1]) return match[1]
  }
  throw new Error(`Packed Studio exited before startup: ${output.trim()}`)
}

async function verifyStudioSocket(
  projectRoot: string,
  serverUrl: string,
): Promise<void> {
  const path = join(projectRoot, 'node-studio-socket.mjs')
  await Bun.write(
    path,
    String.raw`import assert from 'node:assert/strict'
import { appendFile } from 'node:fs/promises'
const url = new URL(process.argv[2])
const unauthorized = await fetch(new URL('/api/project', url))
assert.equal(unauthorized.status, 401)
url.pathname = '/api/workspace/events'
url.protocol = 'ws:'
const socket = new WebSocket(url)
try {
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('Studio WebSocket handshake failed')), { once: true })
  })
  const event = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Studio did not stream a document change')), 5000)
    socket.addEventListener('message', (message) => {
      const event = JSON.parse(message.data)
      if (event.type === 'disk-changed' && event.uri === 'features/node.feature') {
        clearTimeout(timeout)
        resolve(event)
      }
    })
  })
  await appendFile('features/node.feature', '\n# Node WebSocket acceptance\n')
  await event
} finally {
  socket.close()
}
`,
  )
  runCommand(
    ['node', path, serverUrl],
    projectRoot,
    'Node Studio cannot stream authenticated document updates',
  )
}

async function verifyBuiltStudio(
  projectRoot: string,
  pickleExecutable: string,
): Promise<void> {
  await Bun.write(
    join(projectRoot, 'pickle.config.jsonc'),
    `${JSON.stringify({ schemaVersion: 1 }, null, 2)}\n`,
  )
  const studio = Bun.spawn({
    cmd: [pickleExecutable, 'studio', '--no-open', '--port', '0'],
    cwd: projectRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: consumerEnvironment,
  })
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Packed Studio did not start within 30 seconds'))
      }, 30_000)
    })
    const url = await Promise.race([studioUrl(studio.stdout), timeout])
    const response = await fetch(url)
    const html = await response.text()
    assertAcceptance(
      response.ok,
      `Packed Studio returned HTTP ${response.status}`,
    )
    assertAcceptance(
      /<html[\s>]/i.test(html),
      'Packed Studio did not return its built application',
    )
    await verifyStudioSocket(projectRoot, url)
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    studio.kill('SIGINT')
    await studio.exited
  }
}

async function acceptPackedRelease(root = repositoryRoot): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'pickle-release-install-'))
  try {
    const artifactRoot = join(temporaryRoot, 'artifacts')
    const projectRoot = join(temporaryRoot, 'project')
    await mkdir(artifactRoot)
    await mkdir(projectRoot)
    const { artifacts, version } = await packReleaseSet(root, artifactRoot)
    consumerEnvironment.PICKLE_HOME = join(temporaryRoot, 'home')
    consumerEnvironment.npm_config_cache = join(
      tmpdir(),
      'pickle-release-npm-cache',
    )
    assertAcceptance(
      !Bun.which('bun', { PATH: consumerEnvironment.PATH ?? '' }),
      'Consumer PATH must exclude Bun',
    )
    await installReleaseSet(projectRoot, artifacts)

    const pickleExecutable = join(projectRoot, 'node_modules/.bin/pickle')
    const installedVersion = runCommand(
      [pickleExecutable, '--version'],
      projectRoot,
      'Packed CLI cannot run',
    ).trim()
    assertAcceptance(
      installedVersion === version,
      `Packed CLI reported ${installedVersion}; expected ${version}`,
    )
    await verifyPackageImports(projectRoot)
    await verifyProjectRun(projectRoot, pickleExecutable)
    await verifyNodeCache(projectRoot)
    await verifyNodeWorker(projectRoot)
    await verifyArchiveHandoff(projectRoot, pickleExecutable)
    await verifyBuiltStudio(projectRoot, pickleExecutable)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  await acceptPackedRelease()
  console.log(
    'Accepted Node-only npm installation, typed extensions, test execution, SQLite cache, mobile worker, Studio WebSocket updates, and archive handoff',
  )
}
