import type { ScenarioSelection } from '@pickle-spec/spec'
import { requiredValue } from '../required-value'
import { runScenario } from './run-scenario'
import type {
  ExecutionCachePolicy,
  ExecutionPolicy,
  ExecutionTargetAdapter,
  ExecutionTargetProfile,
  RunEvent,
  ScenarioExecutionCache,
  ScenarioRun,
  TestResult,
} from './run-scenario-types'

export interface RunTarget {
  executionTargetProfile: ExecutionTargetProfile
  adapter: ExecutionTargetAdapter
}

export interface ScenarioCompletion {
  result: TestResult
  scheduleIndex: number
}

export type ScheduledTestResult = {
  specification: TestResult['specification']
  scenario: TestResult['scenario']
  executionTargetProfile: TestResult['executionTargetProfile']
}

export interface RunScheduleInput {
  selections: readonly ScenarioSelection[]
  executionTargetProfiles: readonly ExecutionTargetProfile[]
  includeTarget?: (
    selection: ScenarioSelection,
    executionTargetProfile: ExecutionTargetProfile,
  ) => boolean
}

type ScheduledScenarioTarget = {
  selection: ScenarioSelection
  target: RunTarget
}

export interface RunScenariosInput extends ExecutionPolicy {
  selections: readonly ScenarioSelection[]
  targets?: readonly RunTarget[]
  executionTargetProfile?: ExecutionTargetProfile
  adapter?: ExecutionTargetAdapter
  executionCache?: ScenarioExecutionCache
  cachePolicy?: ExecutionCachePolicy
  applicationRevision?: string
  concurrency?: number
  now?: () => Date
  signal?: AbortSignal
  onEvent?: (
    event: RunEvent,
    selection: ScenarioSelection,
  ) => void | Promise<void>
  onResult?: (completion: ScenarioCompletion) => void | Promise<void>
}

function scenarioTargets(
  selections: readonly ScenarioSelection[],
  targets: readonly RunTarget[],
): ScheduledScenarioTarget[] {
  return selections.flatMap((selection) =>
    targets.map((target) => ({ selection, target })),
  )
}

function scheduledTestResult(
  selection: ScenarioSelection,
  executionTargetProfile: ExecutionTargetProfile,
): ScheduledTestResult {
  return {
    specification: {
      uri: selection.specification.source.uri,
      name: selection.specification.name,
    },
    scenario: {
      name: selection.scenario.template?.name ?? selection.scenario.name,
      id: selection.scenario.id,
      examplesId: selection.scenario.examplesId,
      examplesRowId: selection.scenario.examplesRowId,
    },
    executionTargetProfile,
  }
}

export function scheduleScenarios(
  input: RunScheduleInput,
): ScheduledTestResult[] {
  return input.selections.flatMap((selection) =>
    input.executionTargetProfiles
      .filter(
        (executionTargetProfile) =>
          input.includeTarget?.(selection, executionTargetProfile) !== false,
      )
      .map((executionTargetProfile) =>
        scheduledTestResult(selection, executionTargetProfile),
      ),
  )
}

function availableCapabilities(target: RunTarget): Set<string> {
  return new Set(
    target.executionTargetProfile.capabilities ??
      target.adapter.capabilities ??
      [],
  )
}

export function validateTargetSelection(
  selections: readonly ScenarioSelection[],
  targets: readonly RunTarget[],
): void {
  if (targets.length === 0) {
    throw new Error(
      'A test run must select at least one execution target profile',
    )
  }

  for (const target of targets) {
    const capabilities = availableCapabilities(target)
    for (const { scenario } of selections) {
      const missing = (scenario.capabilityRequirements ?? []).filter(
        (requirement) => !capabilities.has(requirement),
      )
      if (missing.length > 0) {
        throw new Error(
          `Execution target profile "${target.executionTargetProfile.id}" lacks required capabilities ` +
            `for Scenario "${scenario.name}": ${missing.join(', ')}`,
        )
      }
    }
  }
}

function resolveTargets(input: RunScenariosInput): readonly RunTarget[] {
  if (input.targets) return input.targets
  if (input.executionTargetProfile && input.adapter) {
    return [
      {
        executionTargetProfile: input.executionTargetProfile,
        adapter: input.adapter,
      },
    ]
  }
  return []
}

export async function runScenarios(
  input: RunScenariosInput,
): Promise<ScenarioRun[]> {
  const concurrency = input.concurrency ?? 1
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be an integer greater than or equal to 1')
  }

  const targets = resolveTargets(input)
  validateTargetSelection(input.selections, targets)

  const scheduledTargets = scenarioTargets(input.selections, targets)
  const runs = new Array<ScenarioRun>(scheduledTargets.length)
  let nextIndex = 0
  const workerCount = Math.min(concurrency, scheduledTargets.length)
  const onEvent = input.onEvent

  async function work(): Promise<void> {
    while (nextIndex < scheduledTargets.length) {
      const index = nextIndex++
      const { selection, target } = requiredValue(scheduledTargets[index])
      const run = await runScenario({
        specification: selection.specification,
        scenario: selection.scenario,
        executionTargetProfile: target.executionTargetProfile,
        adapter: target.adapter,
        executionCache: input.executionCache,
        cachePolicy: input.cachePolicy,
        applicationRevision: input.applicationRevision,
        now: input.now,
        signal: input.signal,
        retry: input.retry,
        timeout: input.timeout,
        onEvent: onEvent
          ? (event) =>
              onEvent(
                event.type === 'scenario-finished'
                  ? { ...event, scheduleIndex: index }
                  : event,
                selection,
              )
          : undefined,
      })
      runs[index] = run
      await input.onResult?.({
        result: run.result,
        scheduleIndex: index,
      })
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => work()))
  return runs
}
