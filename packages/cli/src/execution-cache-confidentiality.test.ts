import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { providerCredentialEnvironmentNames } from '@pickle-spec/runner/benchmarking'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function tempRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `${name}-`))
  roots.push(root)
  return root
}

async function filesUnder(root: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...(await filesUnder(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

async function fileContains(path: string, value: string): Promise<boolean> {
  const bytes = Buffer.from(await Bun.file(path).arrayBuffer())
  return bytes.includes(Buffer.from(value))
}

async function writeConfidentialityFeature(
  path: string,
  runtimeValue: string,
): Promise<void> {
  await Bun.write(
    path,
    `@pickle:id:specprivate000000 @pickle:state:active
Feature: Execution cache confidentiality
  @pickle:id:scnprivate0000000
  Scenario Outline: Keep a runtime value private
    When the private value <token> is applied
    Then the deterministic result is available

    @pickle:id:exsprivate0000000
    Examples:
      | pickle_id        | token          |
      | rowprivate000000 | ${runtimeValue} |
`,
  )
}

interface CacheInspection {
  databasePath: string
  files: string[]
  keys: unknown[]
  entries: unknown[]
  leases: unknown[]
  leaseOutcomes: unknown[]
}

async function inspectCache(cacheRoot: string): Promise<CacheInspection> {
  const files = await filesUnder(cacheRoot)
  const databasePath = files.find((path) =>
    path.endsWith('execution-cache.sqlite'),
  )
  if (!databasePath) throw new Error('Execution cache database missing')
  const database = new Database(databasePath, { readonly: true, strict: true })
  try {
    return {
      databasePath,
      files,
      keys: database
        .query(
          `SELECT key_digest, project_key, scenario_id, scenario_revision,
                  execution_target_profile_id,
                  target_configuration_fingerprint, application_revision,
                  adapter_kind, adapter_cache_schema_version
           FROM entries`,
        )
        .all(),
      entries: database.query('SELECT * FROM entries').all(),
      leases: database.query('SELECT * FROM leases').all(),
      leaseOutcomes: database.query('SELECT * FROM lease_outcomes').all(),
    }
  } finally {
    database.close()
  }
}

type ReporterRecord = {
  kind?: string
  result?: unknown
}

function outputText(output: Uint8Array): string {
  return Buffer.from(output).toString()
}

function reporterRecords(output: Uint8Array): ReporterRecord[] {
  return outputText(output)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReporterRecord)
}

interface PickleRunOptions {
  bunPath: string
  cliPath: string
  projectRoot: string
  cacheRoot: string
  runtimeSentinel: string
  inferenceMarker: string
  cacheOnly?: boolean
  evaluationDelayMs?: number
}

function childEnvironment(
  options: PickleRunOptions,
): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = {
    ...Bun.env,
    CI: 'true',
    PICKLE_CACHE_ROOT: options.cacheRoot,
    PICKLE_CONFIDENTIALITY_SENTINEL: options.runtimeSentinel,
    PICKLE_CONFIDENTIALITY_INFERENCE_MARKER: options.inferenceMarker,
    PICKLE_CONFIDENTIALITY_FAIL_ON_INFERENCE: options.cacheOnly
      ? 'true'
      : 'false',
    PICKLE_CONFIDENTIALITY_EVALUATION_DELAY_MS: String(
      options.evaluationDelayMs ?? 0,
    ),
    PICKLE_CONFIDENTIALITY_FORBIDDEN_ENV_NAMES:
      providerCredentialEnvironmentNames.join(','),
  }
  for (const name of providerCredentialEnvironmentNames) {
    environment[name] = `must-not-reach-child-${name}`
  }
  for (const name of providerCredentialEnvironmentNames) {
    delete environment[name]
  }
  return environment
}

async function executePickle(
  options: PickleRunOptions,
  args: readonly string[],
) {
  const process = Bun.spawn({
    cmd: [options.bunPath, options.cliPath, ...args],
    cwd: options.projectRoot,
    env: childEnvironment(options),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).bytes(),
    new Response(process.stderr).bytes(),
  ])
  return { exitCode, stdout, stderr }
}

function runPickle(options: PickleRunOptions) {
  return executePickle(options, [
    'run',
    '--reporter',
    'ndjson',
    ...(options.cacheOnly ? ['--cache-only'] : []),
  ])
}

test('keeps runtime values and model credentials out of public cache-only and concurrent runs', async () => {
  const projectRoot = await tempRoot('pickle-confidentiality-project')
  const cacheRoot = await tempRoot('pickle-confidentiality-cache')
  const concurrentCacheRoot = await tempRoot(
    'pickle-concurrent-confidentiality-cache',
  )
  const runtimeSentinelA = `runtime-a-${crypto.randomUUID()}@example.test`
  const runtimeSentinelB = `runtime-b-${crypto.randomUUID()}@example.test`
  const inferenceMarker = join(projectRoot, 'inference-marker.txt')
  const concurrentInferenceMarker = join(
    projectRoot,
    'concurrent-inference-marker.txt',
  )
  const featureDirectory = join(projectRoot, 'features')
  const configPath = join(projectRoot, 'pickle.config.jsonc')
  const featurePath = join(featureDirectory, 'confidentiality.feature')
  const extensionsPath = join(projectRoot, 'pickle.extensions.ts')
  await mkdir(featureDirectory)
  await Bun.write(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      specifications: 'features/**/*.feature',
      applicationRevision: 'confidentiality-app-1',
      executionTargetProfile: { id: 'confidentiality-target' },
    }),
  )
  await writeConfidentialityFeature(featurePath, runtimeSentinelA)
  await Bun.write(
    extensionsPath,
    `import { appendFile } from 'node:fs/promises'

const placeholder = '<token>'
const expectedPayload = {
  operations: [
    { operation: 'fill', value: placeholder },
    { assertion: 'value-equals', expected: placeholder },
  ],
}

function runtimeValue(context) {
  return context?.runtimeBindings.find((binding) => binding.name === 'token')?.value
}

export default {
  adapter: {
    executionCache: {
      adapterKind: 'confidentiality-fixture',
      adapterCacheSchemaVersion: '1',
      targetConfigurationFingerprint: 'confidentiality-target-1',
      parse(payload) {
        return JSON.stringify(payload) === JSON.stringify(expectedPayload)
          ? payload
          : undefined
      },
    },
    async openSession(input) {
      const forbiddenEnvironmentNames = process.env
        .PICKLE_CONFIDENTIALITY_FORBIDDEN_ENV_NAMES
        ?.split(',') ?? []
      const exposedCredential = forbiddenEnvironmentNames.find(
        (name) => process.env[name] !== undefined,
      )
      if (exposedCredential) {
        throw new Error(
          \`model credential reached child: \${exposedCredential}\`,
        )
      }
      let inferenceCount = 0
      async function evaluate(context) {
        if (process.env.PICKLE_CONFIDENTIALITY_FAIL_ON_INFERENCE === 'true') {
          throw new Error('cache-only attempted Adaptive inference')
        }
        if (runtimeValue(context) !== process.env.PICKLE_CONFIDENTIALITY_SENTINEL) {
          throw new Error('runtime value did not reach the adapter boundary')
        }
        if (inferenceCount === 0) {
          inferenceCount = 1
          const inferenceMarker =
            process.env.PICKLE_CONFIDENTIALITY_INFERENCE_MARKER
          if (!inferenceMarker) throw new Error('inference marker is absent')
          await appendFile(inferenceMarker, 'adaptive-evaluation\\n')
          const evaluationDelayMs = Number(
            process.env.PICKLE_CONFIDENTIALITY_EVALUATION_DELAY_MS ?? 0,
          )
          if (evaluationDelayMs > 0) await Bun.sleep(evaluationDelayMs)
        }
      }

      return {
        async executeStep(_step, _signal, context) {
          if (runtimeValue(context) !== process.env.PICKLE_CONFIDENTIALITY_SENTINEL) {
            throw new Error('runtime value did not reach the adapter boundary')
          }
          if (input.mode === 'adaptive') await evaluate(context)
          else if (
            JSON.stringify(input.executionCache?.adapterPayload) !==
            JSON.stringify(expectedPayload)
          ) {
            throw new Error('Replay did not receive the placeholder payload')
          }
          return {
            state: 'passed',
            resolvedActions: [
              { description: \`Execute: \${context.templateStep.text}\` },
            ],
          }
        },
        async complete() {
          if (input.mode === 'replay') return { inferenceCount: 0 }
          return {
            inferenceCount,
            evaluationModel: 'confidentiality-fixture',
            replayRepresentation: {
              cacheable: true,
              adapterPayload: expectedPayload,
              requiredVariables: ['token'],
            },
          }
        },
        async close() {},
      }
    },
  },
}
`,
  )

  const bunPath = Bun.which('bun')
  expect(bunPath).not.toBeNull()
  if (!bunPath) throw new Error('Bun executable missing')
  const cliPath = resolve(import.meta.dir, 'cli.ts')
  const runOptions = {
    bunPath,
    cliPath,
    projectRoot,
    cacheRoot,
    runtimeSentinel: runtimeSentinelA,
    inferenceMarker,
  }
  const adaptive = await runPickle(runOptions)
  expect(adaptive.exitCode).toBe(0)
  const initialCache = await inspectCache(cacheRoot)

  await writeConfidentialityFeature(featurePath, runtimeSentinelB)
  const cacheOnly = await runPickle({
    ...runOptions,
    runtimeSentinel: runtimeSentinelB,
    cacheOnly: true,
  })
  const adaptiveResult = reporterRecords(adaptive.stdout).find(
    (record) => record.kind === 'test-result',
  )?.result
  const cacheOnlyResult = reporterRecords(cacheOnly.stdout).find(
    (record) => record.kind === 'test-result',
  )?.result

  expect(cacheOnly.exitCode).toBe(0)
  expect(adaptiveResult).toMatchObject({
    state: 'passed',
    executionMode: 'adaptive',
    cacheOutcome: 'miss',
    inferenceCount: 1,
  })
  expect(cacheOnlyResult).toMatchObject({
    state: 'passed',
    executionMode: 'replay',
    cacheOutcome: 'hit',
    inferenceCount: 0,
  })
  expect(await Bun.file(inferenceMarker).text()).toBe('adaptive-evaluation\n')

  const sequentialCache = await inspectCache(cacheRoot)
  expect(sequentialCache.keys).toEqual(initialCache.keys)
  expect(sequentialCache.keys).toHaveLength(1)
  expect(sequentialCache.entries).toHaveLength(1)
  expect(JSON.stringify(sequentialCache.entries)).toContain('<token>')
  expect(sequentialCache.leases).toEqual([])
  expect(sequentialCache.leaseOutcomes).toEqual([])

  const concurrentOptions = {
    ...runOptions,
    cacheRoot: concurrentCacheRoot,
    runtimeSentinel: runtimeSentinelB,
    inferenceMarker: concurrentInferenceMarker,
    evaluationDelayMs: 750,
  }
  const cacheInitialization = await executePickle(concurrentOptions, [
    'cache',
    'inspect',
  ])
  expect(cacheInitialization.exitCode).toBe(0)
  expect(outputText(cacheInitialization.stderr)).toBe('')
  const concurrentRuns = await Promise.all([
    runPickle(concurrentOptions),
    runPickle(concurrentOptions),
  ])
  const concurrentResults = concurrentRuns.map(
    (execution) =>
      reporterRecords(execution.stdout).find(
        (record) => record.kind === 'test-result',
      )?.result,
  )

  expect(
    concurrentRuns.map((execution) => outputText(execution.stderr)),
  ).toEqual(['', ''])
  expect(concurrentRuns.map((execution) => execution.exitCode)).toEqual([0, 0])
  expect(concurrentResults).toHaveLength(2)
  expect(concurrentResults).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        state: 'passed',
        executionMode: 'adaptive',
        cacheOutcome: 'miss',
        inferenceCount: 1,
      }),
      expect.objectContaining({
        state: 'passed',
        executionMode: 'replay',
        cacheOutcome: 'hit',
        inferenceCount: 0,
      }),
    ]),
  )
  expect(await Bun.file(concurrentInferenceMarker).text()).toBe(
    'adaptive-evaluation\n',
  )

  const concurrentCache = await inspectCache(concurrentCacheRoot)
  expect(concurrentCache.keys).toEqual(initialCache.keys)
  expect(concurrentCache.entries).toHaveLength(1)
  expect(concurrentCache.leases).toEqual([])
  expect(concurrentCache.leaseOutcomes).toEqual([])

  const executions = [
    adaptive,
    cacheOnly,
    cacheInitialization,
    ...concurrentRuns,
  ]
  const processOutput = executions
    .flatMap((execution) => [execution.stdout, execution.stderr])
    .map(outputText)
    .join('\n')
  const runtimeSentinels = [runtimeSentinelA, runtimeSentinelB]
  for (const runtimeSentinel of runtimeSentinels) {
    expect(processOutput).not.toContain(runtimeSentinel)
    expect(await fileContains(inferenceMarker, runtimeSentinel)).toBe(false)
    expect(await fileContains(concurrentInferenceMarker, runtimeSentinel)).toBe(
      false,
    )
    for (const cache of [sequentialCache, concurrentCache]) {
      expect(JSON.stringify(cache.keys)).not.toContain(runtimeSentinel)
      expect(JSON.stringify(cache.entries)).not.toContain(runtimeSentinel)
      expect(JSON.stringify(cache.leases)).not.toContain(runtimeSentinel)
      expect(JSON.stringify(cache.leaseOutcomes)).not.toContain(runtimeSentinel)
    }
  }

  const runStateFiles = await filesUnder(join(projectRoot, '.pickle'))
  const eventFiles = runStateFiles.filter((path) =>
    path.endsWith('events.ndjson'),
  )
  const manifestFiles = runStateFiles.filter((path) =>
    path.endsWith('manifest.json'),
  )
  expect(eventFiles).toHaveLength(4)
  expect(manifestFiles).toHaveLength(4)

  const fixtureFiles = new Set([
    configPath,
    featurePath,
    extensionsPath,
    inferenceMarker,
    concurrentInferenceMarker,
  ])
  const generatedProjectFiles = (await filesUnder(projectRoot)).filter(
    (path) => !fixtureFiles.has(path),
  )
  const persistentFiles = [
    ...generatedProjectFiles,
    ...sequentialCache.files,
    ...concurrentCache.files,
  ]
  for (const runtimeSentinel of runtimeSentinels) {
    for (const path of persistentFiles) {
      expect(await fileContains(path, runtimeSentinel)).toBe(false)
    }
    for (const cache of [sequentialCache, concurrentCache]) {
      for (const suffix of ['', '-wal', '-shm']) {
        const path = `${cache.databasePath}${suffix}`
        if (await Bun.file(path).exists()) {
          expect(await fileContains(path, runtimeSentinel)).toBe(false)
        }
      }
    }
  }
})
