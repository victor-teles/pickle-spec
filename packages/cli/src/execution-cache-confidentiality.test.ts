import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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
  command: string
  projectRoot: string
  cacheRoot: string
  runtimeSentinel: string
  inferenceMarker: string
  cacheOnly?: boolean
}

function runPickle(options: PickleRunOptions) {
  return Bun.spawnSync({
    cmd: [
      options.command,
      'run',
      '--reporter',
      'ndjson',
      ...(options.cacheOnly ? ['--cache-only'] : []),
    ],
    cwd: options.projectRoot,
    env: {
      ...Bun.env,
      CI: 'true',
      PICKLE_CACHE_ROOT: options.cacheRoot,
      PICKLE_CONFIDENTIALITY_SENTINEL: options.runtimeSentinel,
      PICKLE_CONFIDENTIALITY_INFERENCE_MARKER: options.inferenceMarker,
      PICKLE_CONFIDENTIALITY_FAIL_ON_INFERENCE: options.cacheOnly
        ? 'true'
        : 'false',
    },
  })
}

test('keeps runtime values out of public cache-only state after one Adaptive evaluation', async () => {
  const projectRoot = await tempRoot('pickle-confidentiality-project')
  const cacheRoot = await tempRoot('pickle-confidentiality-cache')
  const runtimeSentinel = `runtime-${crypto.randomUUID()}@example.test`
  const inferenceMarker = join(projectRoot, 'inference-marker.txt')
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
  await Bun.write(
    featurePath,
    `@pickle:id:specprivate000000 @pickle:state:active
Feature: Execution cache confidentiality
  @pickle:id:scnprivate0000000
  Scenario Outline: Keep a runtime value private
    When the private value <token> is applied
    Then the deterministic result is available

    @pickle:id:exsprivate0000000
    Examples:
      | pickle_id        | token              |
      | rowprivate000000 | ${runtimeSentinel} |
`,
  )
  await Bun.write(
    extensionsPath,
    `const placeholder = '<token>'
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
          await Bun.write(
            process.env.PICKLE_CONFIDENTIALITY_INFERENCE_MARKER,
            'adaptive-evaluation\\n',
          )
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

  const command = resolve(import.meta.dir, 'cli.ts')
  const runOptions = {
    command,
    projectRoot,
    cacheRoot,
    runtimeSentinel,
    inferenceMarker,
  }
  const adaptive = runPickle(runOptions)
  const cacheOnly = runPickle({ ...runOptions, cacheOnly: true })
  const processOutput = [
    adaptive.stdout,
    adaptive.stderr,
    cacheOnly.stdout,
    cacheOnly.stderr,
  ]
    .map(outputText)
    .join('\n')
  const adaptiveResult = reporterRecords(adaptive.stdout).find(
    (record) => record.kind === 'test-result',
  )?.result
  const cacheOnlyResult = reporterRecords(cacheOnly.stdout).find(
    (record) => record.kind === 'test-result',
  )?.result

  expect(adaptive.exitCode).toBe(0)
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
  expect(processOutput).not.toContain(runtimeSentinel)
  expect(await Bun.file(inferenceMarker).text()).toBe('adaptive-evaluation\n')
  expect(await fileContains(inferenceMarker, runtimeSentinel)).toBe(false)

  const cacheFiles = await filesUnder(cacheRoot)
  const databasePath = cacheFiles.find((path) =>
    path.endsWith('execution-cache.sqlite'),
  )
  expect(databasePath).toBeDefined()
  if (!databasePath) throw new Error('Execution cache database missing')
  const database = new Database(databasePath, { readonly: true, strict: true })
  const keys = database
    .query(
      `SELECT key_digest, project_key, scenario_id, scenario_revision,
              execution_target_profile_id, target_configuration_fingerprint,
              application_revision, adapter_kind, adapter_cache_schema_version
       FROM entries`,
    )
    .all()
  const entries = database.query('SELECT * FROM entries').all()
  const leases = database.query('SELECT * FROM leases').all()
  const leaseOutcomes = database.query('SELECT * FROM lease_outcomes').all()
  database.close()

  expect(keys).toHaveLength(1)
  expect(JSON.stringify(keys)).not.toContain(runtimeSentinel)
  expect(entries).toHaveLength(1)
  expect(JSON.stringify(entries)).toContain('<token>')
  expect(JSON.stringify(entries)).not.toContain(runtimeSentinel)
  expect(leases).toEqual([])
  expect(leaseOutcomes).toEqual([])

  const runStateFiles = await filesUnder(join(projectRoot, '.pickle'))
  const eventFiles = runStateFiles.filter((path) =>
    path.endsWith('events.ndjson'),
  )
  const manifestFiles = runStateFiles.filter((path) =>
    path.endsWith('manifest.json'),
  )
  expect(eventFiles).toHaveLength(2)
  expect(manifestFiles).toHaveLength(2)

  const fixtureFiles = new Set([
    configPath,
    featurePath,
    extensionsPath,
    inferenceMarker,
  ])
  const generatedProjectFiles = (await filesUnder(projectRoot)).filter(
    (path) => !fixtureFiles.has(path),
  )
  const persistentFiles = [...generatedProjectFiles, ...cacheFiles]
  for (const path of persistentFiles) {
    expect(await fileContains(path, runtimeSentinel)).toBe(false)
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const path = `${databasePath}${suffix}`
    if (await Bun.file(path).exists()) {
      expect(await fileContains(path, runtimeSentinel)).toBe(false)
    }
  }
})
