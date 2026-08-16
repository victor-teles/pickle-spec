#!/usr/bin/env bun

import { basename, resolve } from 'node:path'
import {
  compareTestRuns,
  formatHtml,
  formatJson,
  formatJunit,
  formatNdjson,
  importRunArchive,
  openTestRunStore,
  writeRunArchive,
} from '@pickle-spec/runner'
import type {
  SelectionOptions,
  Specification,
  SpecificationState,
} from '@pickle-spec/spec'
import type {
  StudioAuthoringModel,
  StudioRunRequest,
  StudioSpecification,
} from '@pickle-spec/studio'
import { startStudio } from '@pickle-spec/studio'
import {
  defaultModelName,
  screenshotModes,
  type WebAdapterOptions,
} from '@pickle-spec/web'
import { defaultSpecificationGlob, loadConfig } from './config'
import {
  loadExtensions,
  loadPersistedRun,
  loadProjectSpecifications,
  startProjectRun,
} from './execute-run'
import { checkProject, initializeProject, migrateProject } from './project'

interface RunArguments {
  pattern?: string
  configPath?: string
  extensionsPath?: string
  suite?: string
  profiles?: string[]
  selection: SelectionOptions
  retries?: number
  concurrency?: number
  language?: string
  scenarioTimeoutMs?: number
  stepTimeoutMs?: number
  reuseServer?: boolean
  headed?: boolean
  screenshotMode?: NonNullable<WebAdapterOptions['screenshots']>['mode']
  applicationRevision?: string
  junitPath?: string
  jsonPath?: string
  ndjsonPath?: string
  rerunId?: string
  failures?: boolean
  adaptations?: boolean
  fast?: boolean
}

const dayMs = 24 * 60 * 60 * 1000

function integer(value: string, flag: string, minimum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(
      `${flag} requires an integer greater than or equal to ${minimum}`,
    )
  }
  return parsed
}

function valueAfter(argv: string[], index: number): string {
  const value = argv[index + 1]
  if (!value || value.startsWith('--'))
    throw new Error(`${argv[index]} requires a value`)
  return value
}

function parseShard(value: string): { index: number; total: number } {
  const match = value.match(/^(\d+)\/(\d+)$/)
  if (!match) throw new Error('--shard requires <index>/<total>')
  return { index: Number(match[1]), total: Number(match[2]) }
}

function parseRunArguments(argv: string[]): RunArguments {
  if (argv[0] !== 'run')
    throw new Error('Usage: pickle run [specifications] [options]')
  const args: RunArguments = { selection: {} }
  let index = 1
  if (argv[index] && !argv[index]!.startsWith('-')) args.pattern = argv[index++]

  while (index < argv.length) {
    const flag = argv[index]!
    switch (flag) {
      case '--config':
        args.configPath = valueAfter(argv, index++)
        break
      case '--extensions':
        args.extensionsPath = valueAfter(argv, index++)
        break
      case '--suite':
        args.suite = valueAfter(argv, index++)
        break
      case '--profile':
        args.profiles = [...(args.profiles ?? []), valueAfter(argv, index++)]
        break
      case '--scenario':
        args.selection.scenarioName = valueAfter(argv, index++)
        break
      case '--tag':
      case '-t':
        args.selection.tagExpression = valueAfter(argv, index++)
        break
      case '--state': {
        const state = valueAfter(argv, index++)
        args.selection.states = [
          ...(args.selection.states ?? []),
          state as SpecificationState,
        ]
        break
      }
      case '--shard':
        args.selection.shard = parseShard(valueAfter(argv, index++))
        break
      case '--retries':
        args.retries = integer(valueAfter(argv, index++), flag, 0)
        break
      case '--concurrency':
      case '-j':
        args.concurrency = integer(valueAfter(argv, index++), flag, 1)
        break
      case '--language':
      case '-l':
        args.language = valueAfter(argv, index++)
        break
      case '--scenario-timeout': {
        args.scenarioTimeoutMs = integer(valueAfter(argv, index++), flag, 1)
        break
      }
      case '--step-timeout':
        args.stepTimeoutMs = integer(valueAfter(argv, index++), flag, 1)
        break
      case '--reuse-server':
        args.reuseServer = true
        break
      case '--headed':
        args.headed = true
        break
      case '--screenshot': {
        const mode = valueAfter(argv, index++)
        if (
          !screenshotModes.includes(mode as (typeof screenshotModes)[number])
        ) {
          throw new Error('--screenshot requires off, on-failure, or on-step')
        }
        args.screenshotMode = mode as RunArguments['screenshotMode']
        break
      }
      case '--application-revision':
        args.applicationRevision = valueAfter(argv, index++)
        break
      case '--junit':
        args.junitPath = valueAfter(argv, index++)
        break
      case '--json':
        args.jsonPath = valueAfter(argv, index++)
        break
      case '--ndjson':
        args.ndjsonPath = valueAfter(argv, index++)
        break
      case '--rerun':
        args.rerunId = valueAfter(argv, index++)
        break
      case '--failures':
        args.failures = true
        break
      case '--adaptations':
        args.adaptations = true
        break
      case '--fast':
        args.fast = true
        break
      default:
        throw new Error(`Unknown option: ${flag}`)
    }
    index++
  }
  return args
}

async function run(argv: string[]): Promise<number> {
  const args = parseRunArguments(argv)
  const config = await loadConfig(args.configPath)
  const controller = new AbortController()
  const onSigint = () => controller.abort()
  process.on('SIGINT', onSigint)
  try {
    const started = await startProjectRun({
      root: process.cwd(),
      config,
      options: args,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'run-started') return
        console.log(JSON.stringify({ kind: 'run-event', event }))
      },
    })
    const { runs, manifest } = await started.done
    const store = openTestRunStore({ root: process.cwd() })
    if (args.junitPath) await Bun.write(args.junitPath, formatJunit(manifest))
    if (args.jsonPath) await Bun.write(args.jsonPath, formatJson(manifest))
    if (args.ndjsonPath) {
      const persisted = await store.open(started.id)
      await Bun.write(args.ndjsonPath, formatNdjson(await persisted.events()))
    }
    await store.applyRetention({
      maxAgeMs: config.retention?.days
        ? config.retention.days * dayMs
        : undefined,
      maxBytes: config.retention?.maxBytes,
    })

    for (const scenarioRun of runs) {
      console.log(
        JSON.stringify({ kind: 'test-result', result: scenarioRun.result }),
      )
    }
    const states = runs.map(({ result }) => result.state)
    if (states.includes('cancelled')) return 130
    if (
      states.includes('failed') ||
      states.includes('infrastructure-error') ||
      (config.policy?.adaptedResults === 'reject' &&
        states.includes('passed-with-adaptation'))
    ) {
      return 1
    }
    return 0
  } finally {
    process.off('SIGINT', onSigint)
  }
}

function projectOptions(argv: string[]): {
  configPath?: string
  extensionsPath?: string
} {
  const options: { configPath?: string; extensionsPath?: string } = {}
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index]!
    if (flag === '--config') options.configPath = valueAfter(argv, index++)
    else if (flag === '--extensions')
      options.extensionsPath = valueAfter(argv, index++)
    else throw new Error(`Unknown option: ${flag}`)
  }
  return options
}

function migrateOptions(argv: string[]): {
  configPath?: string
  yes?: boolean
} {
  const options: { configPath?: string; yes?: boolean } = {}
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index]!
    if (flag === '--config') options.configPath = valueAfter(argv, index++)
    else if (flag === '--yes' || flag === '-y') options.yes = true
    else throw new Error(`Unknown option: ${flag}`)
  }
  return options
}

async function compare(argv: string[]): Promise<number> {
  if (argv.length !== 3) {
    throw new Error('Usage: pickle compare <baseline-id> <candidate-id>')
  }
  const baseline = await loadPersistedRun(process.cwd(), argv[1]!)
  const candidate = await loadPersistedRun(process.cwd(), argv[2]!)
  console.log(
    JSON.stringify(
      compareTestRuns(baseline.manifest, candidate.manifest),
      null,
      2,
    ),
  )
  return 0
}

async function importArchive(argv: string[]): Promise<number> {
  if (argv.length !== 2) throw new Error('Usage: pickle import <archive>')
  const imported = await importRunArchive({
    root: process.cwd(),
    archivePath: resolve(argv[1]!),
  })
  console.log(
    JSON.stringify({
      kind: 'imported-run',
      id: imported.manifest.id,
      preservedArchivePath: imported.preservedArchivePath,
    }),
  )
  return 0
}

async function exportRun(argv: string[]): Promise<number> {
  if (argv[0] !== 'export' || !argv[1]) {
    throw new Error(
      'Usage: pickle export <id> (--archive <path> | --html <path>) [--all-artifacts]',
    )
  }
  const runId = argv[1]
  let archivePath: string | undefined
  let htmlPath: string | undefined
  let allArtifacts = false
  for (let index = 2; index < argv.length; index++) {
    const flag = argv[index]!
    if (flag === '--archive') archivePath = valueAfter(argv, index++)
    else if (flag === '--html') htmlPath = valueAfter(argv, index++)
    else if (flag === '--all-artifacts') allArtifacts = true
    else throw new Error(`Unknown option: ${flag}`)
  }
  if (!archivePath && !htmlPath) {
    throw new Error('pickle export requires --archive or --html')
  }
  if (archivePath && htmlPath) {
    throw new Error('pickle export accepts either --archive or --html')
  }
  if (archivePath) {
    await writeRunArchive({
      root: process.cwd(),
      runId,
      outputPath: resolve(archivePath),
    })
    return 0
  }

  const { manifest } = await loadPersistedRun(process.cwd(), runId)
  const html = await formatHtml(manifest, {
    artifacts: allArtifacts ? 'all' : 'failures-and-adaptations',
  })
  const htmlBytes = Buffer.byteLength(html, 'utf8')
  const warningThreshold = 10 * 1024 * 1024
  if (allArtifacts && htmlBytes > warningThreshold) {
    console.error(
      `Warning: HTML export includes every available test artifact and is larger than 10 MB (${htmlBytes} bytes).`,
    )
  }
  await Bun.write(resolve(htmlPath!), html)
  return 0
}

function studioCatalog(
  specifications: readonly Specification[],
): StudioSpecification[] {
  return specifications.map((specification) => ({
    id: specification.id ?? specification.source.uri,
    name: specification.name,
    uri: specification.source.uri,
    scenarios: specification.scenarios.map((scenario) => ({
      id: scenario.id ?? scenario.name,
      name: scenario.name,
    })),
  }))
}

function studioRunSelection(
  request: StudioRunRequest | undefined,
): SelectionOptions | undefined {
  if (!request?.paths?.length && !request?.scenarioName) return undefined
  return {
    ...(request.paths?.length ? { paths: [...request.paths] } : {}),
    ...(request.scenarioName ? { scenarioName: request.scenarioName } : {}),
  }
}

function parseStudioArguments(argv: string[]): {
  configPath?: string
  extensionsPath?: string
  open: boolean
  port?: number
} {
  if (argv[0] !== 'studio') throw new Error('Usage: pickle studio [options]')
  const options: {
    configPath?: string
    extensionsPath?: string
    open: boolean
    port?: number
  } = { open: true }
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index]!
    if (flag === '--no-open') options.open = false
    else if (flag === '--port')
      options.port = integer(valueAfter(argv, index++), flag, 0)
    else if (flag === '--config') options.configPath = valueAfter(argv, index++)
    else if (flag === '--extensions')
      options.extensionsPath = valueAfter(argv, index++)
    else throw new Error(`Unknown option: ${flag}`)
  }
  return options
}

function authoringModel(modelName: string | undefined): StudioAuthoringModel {
  const value = modelName ?? defaultModelName
  const separator = value.indexOf('/')
  if (separator <= 0) return { provider: value, name: value }
  return {
    provider: value.slice(0, separator),
    name: value.slice(separator + 1),
  }
}

async function studio(argv: string[]): Promise<number> {
  const args = parseStudioArguments(argv)
  const root = process.cwd()
  const config = await loadConfig(args.configPath)
  const profiles = config.executionTargetProfiles
    ? Object.keys(config.executionTargetProfiles)
    : [config.executionTargetProfile?.id ?? (config.web ? 'web' : 'custom')]
  const specificationGlobs = config.specifications ?? defaultSpecificationGlob
  const model = authoringModel(config.web?.browser?.modelName)
  async function loadProject() {
    return {
      name: basename(root),
      root,
      profiles,
      suites: Object.keys(config.suites ?? {}),
      specifications: studioCatalog(
        await loadProjectSpecifications(
          specificationGlobs,
          config.language,
          root,
        ),
      ),
      model,
    }
  }
  const extensions = await loadExtensions(args.extensionsPath, root)
  const controller = new AbortController()
  const activeRuns = new Map<string, AbortController>()
  const server = await startStudio({
    project: await loadProject(),
    loadProject,
    specificationGlobs,
    language: config.language,
    authoring: {
      model,
      propose: extensions.authorSpecification,
    },
    gateway: {
      async start(request, onEvent) {
        const runController = new AbortController()
        const onProcessAbort = () => runController.abort()
        controller.signal.addEventListener('abort', onProcessAbort, {
          once: true,
        })
        const started = await startProjectRun({
          root,
          config,
          options: {
            extensionsPath: args.extensionsPath,
            suite: request?.suite,
            profiles: request?.profiles ? [...request.profiles] : undefined,
            selection: studioRunSelection(request),
          },
          signal: runController.signal,
          onEvent,
        })
        activeRuns.set(started.id, runController)
        void started.done
          .catch((error) => {
            console.error(
              error instanceof Error ? error.message : String(error),
            )
          })
          .finally(() => {
            activeRuns.delete(started.id)
            controller.signal.removeEventListener('abort', onProcessAbort)
          })
        return { id: started.id, done: started.done }
      },
      async snapshot(id) {
        const { events, manifest } = await loadPersistedRun(root, id)
        return { id, events, manifest }
      },
      async cancel(id) {
        activeRuns.get(id)?.abort()
      },
    },
    open: args.open,
    port: args.port,
  })
  console.log(`Studio ${server.url}`)
  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      controller.abort()
      server.stop()
      resolve()
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })
  return 0
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === 'init') {
    if (argv.length > 1) throw new Error('Usage: pickle init')
    await initializeProject()
    return 0
  }
  if (argv[0] === 'studio') {
    return studio(argv)
  }
  if (argv[0] === 'check') {
    await checkProject({ ...projectOptions(argv), report: console.log })
    return 0
  }
  if (argv[0] === 'migrate') {
    await migrateProject({ ...migrateOptions(argv), report: console.log })
    return 0
  }
  if (argv[0] === 'compare') {
    return compare(argv)
  }
  if (argv[0] === 'import') {
    return importArchive(argv)
  }
  if (argv[0] === 'export') {
    return exportRun(argv)
  }
  return run(argv)
}

try {
  process.exitCode = await main(Bun.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 2
}
