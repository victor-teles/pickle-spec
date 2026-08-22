import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalExecutionCache, runScenario } from '@pickle-spec/runner'
import { parseSpecification } from '@pickle-spec/spec'
import {
  createWebAdapter,
  type WebAutomation,
  type WebAutomationFactory,
  type WebObservedAction,
} from './web-adapter'
import {
  runWebPerformanceBenchmark,
  type WebPerformanceBenchmarkResult,
} from './web-benchmark'
import {
  bindWebTemplate,
  type WebAssertionDraft,
  type WebInstruction,
  type WebTemplate,
} from './web-execution-cache'

export interface ControlledWebBenchmarkOptions {
  samplePairs: number
}

interface ControlledActionCandidate {
  description: string
  method: 'click'
  selector: string
}

interface ControlledAssertionCandidate {
  kind: 'visible'
  selector: string
}

interface ControlledPageState {
  currentUrl?: string
  settingsSelected: boolean
}

const defaultOptions: ControlledWebBenchmarkOptions = {
  samplePairs: 20,
}

const evaluationCandidateCount = 10_000

function selectControlledAction(): WebObservedAction {
  const candidates = Array.from(
    { length: evaluationCandidateCount },
    (_, index): ControlledActionCandidate => ({
      description: `Candidate action ${index}`,
      method: 'click',
      selector:
        index === evaluationCandidateCount - 1 ? '#settings' : `#${index}`,
    }),
  )
  const parsed = JSON.parse(
    JSON.stringify(candidates),
  ) as ControlledActionCandidate[]
  const selected = parsed.find(
    (candidate) => candidate.selector === '#settings',
  )
  if (!selected) throw new Error('Controlled action evaluation failed')
  return {
    description: selected.description,
    handle: { selector: selected.selector, method: selected.method },
  }
}

function selectControlledAssertion(): WebAssertionDraft {
  const candidates = Array.from(
    { length: evaluationCandidateCount },
    (_, index): ControlledAssertionCandidate => ({
      kind: 'visible',
      selector: index === evaluationCandidateCount - 1 ? '#ready' : `#${index}`,
    }),
  )
  const parsed = JSON.parse(
    JSON.stringify(candidates),
  ) as ControlledAssertionCandidate[]
  const selected = parsed.find((candidate) => candidate.selector === '#ready')
  if (!selected) throw new Error('Controlled assertion compilation failed')
  return selected
}

function boundValue(template: WebTemplate): string | undefined {
  return bindWebTemplate(template, [])
}

function executeControlledInstruction(
  instruction: WebInstruction,
  page: ControlledPageState,
): { success: boolean; message?: string } {
  if (instruction.kind === 'navigate') {
    page.currentUrl = boundValue(instruction.url)
    return { success: page.currentUrl !== undefined }
  }
  if (instruction.kind === 'click') {
    const selector = boundValue(instruction.locator.selector)
    if (page.currentUrl && selector === '#settings') {
      page.settingsSelected = true
      return { success: true }
    }
  }
  if (instruction.kind === 'visible') {
    const selector = boundValue(instruction.locator.selector)
    return { success: page.settingsSelected && selector === '#ready' }
  }
  return {
    success: false,
    message: `Controlled primitive ${instruction.kind} is unsupported`,
  }
}

function controlledFactory(): WebAutomationFactory {
  return {
    async launch() {
      return {
        async openContext(context) {
          const mode = context.mode ?? 'adaptive'
          const page: ControlledPageState = { settingsSelected: false }
          const rejectReplayInference = (method: string) => {
            if (mode === 'replay') {
              throw new Error(`${method} must not be called during Replay`)
            }
          }
          const automation: WebAutomation = {
            async navigate() {},
            async observe() {
              rejectReplayInference('observe')
              return [selectControlledAction()]
            },
            async act() {
              rejectReplayInference('act')
              return { success: true }
            },
            async verify() {
              rejectReplayInference('verify')
              return { meetsExpectation: true, actualState: 'Ready' }
            },
            async compileAssertion() {
              rejectReplayInference('compileAssertion')
              return selectControlledAssertion()
            },
            async executeInstruction(instruction) {
              return executeControlledInstruction(instruction, page)
            },
            async screenshot() {
              return new Uint8Array()
            },
            async readIsolationState() {
              return { cookieCount: 0, storageKeyCount: 0 }
            },
            async close() {},
          }
          return automation
        },
        async close() {},
      }
    },
  }
}

function benchmarkScenario() {
  const specification = parseSpecification({
    uri: 'features/controlled-web-benchmark.feature',
    source: `
Feature: Controlled web benchmark
  Scenario: Open settings
    When I select account settings
    Then the account page is ready
`,
  })
  return { specification, scenario: specification.scenarios[0]! }
}

export async function runControlledWebPerformanceBenchmark(
  options: ControlledWebBenchmarkOptions = defaultOptions,
): Promise<WebPerformanceBenchmarkResult> {
  const workspace = await mkdtemp(join(tmpdir(), 'pickle-web-benchmark-'))
  const projectRoot = join(workspace, 'project')
  await mkdir(projectRoot)
  const adapter = createWebAdapter(
    { baseUrl: 'https://benchmark.invalid' },
    controlledFactory(),
  )
  try {
    const cache = await openLocalExecutionCache({
      projectRoot,
      cacheRoot: join(workspace, 'cache'),
    })
    const { specification, scenario } = benchmarkScenario()
    let runNumber = 0
    const input = {
      specification,
      scenario,
      executionTargetProfile: { id: 'controlled-web' },
      adapter,
      executionCache: {
        store: cache,
        projectKey: cache.projectKey,
        sourceRunId: 'controlled-warmup',
      },
      applicationRevision: 'controlled-app-1',
    }
    const warmup = await runScenario(input)
    if (warmup.result.state !== 'passed') {
      throw new Error('Controlled web benchmark could not warm the cache')
    }

    return await runWebPerformanceBenchmark({
      samplePairs: options.samplePairs,
      async run(mode) {
        runNumber++
        const run = await runScenario({
          ...input,
          cachePolicy: mode === 'adaptive' ? 'refresh' : 'cache-only',
          executionCache: {
            ...input.executionCache,
            sourceRunId: `controlled-${runNumber}`,
          },
        })
        const expectedMode = mode === 'adaptive' ? 'adaptive' : 'replay'
        if (
          run.result.state !== 'passed' ||
          run.result.executionMode !== expectedMode
        ) {
          throw new Error(`Controlled ${mode} benchmark run failed`)
        }
      },
    })
  } finally {
    await adapter.dispose?.()
    await rm(workspace, { recursive: true, force: true })
  }
}
