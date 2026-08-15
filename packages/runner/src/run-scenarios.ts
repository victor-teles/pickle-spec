import type { ScenarioSelection } from '@pickle-spec/spec'
import type { ExecutionPlanStore } from './execution-plan'
import {
  type ExecutionPolicy,
  type ExecutionTargetAdapter,
  type ExecutionTargetProfile,
  type RunEvent,
  runScenario,
  type ScenarioRun,
} from './run-scenario'

export interface RunTarget {
  executionTargetProfile: ExecutionTargetProfile
  adapter: ExecutionTargetAdapter
}

export interface RunScenariosInput extends ExecutionPolicy {
  selections: readonly ScenarioSelection[]
  targets?: readonly RunTarget[]
  executionTargetProfile?: ExecutionTargetProfile
  adapter?: ExecutionTargetAdapter
  plans?: ExecutionPlanStore
  applicationRevision?: string
  ci?: boolean
  concurrency?: number
  signal?: AbortSignal
  onEvent?: (
    event: RunEvent,
    selection: ScenarioSelection,
  ) => void | Promise<void>
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
  throw new Error(
    'A test run must select at least one execution target profile',
  )
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

  const scenarioTargets = input.selections.flatMap((selection) =>
    targets.map((target) => ({ selection, target })),
  )
  const runs = new Array<ScenarioRun>(scenarioTargets.length)
  let nextIndex = 0
  const workerCount = Math.min(concurrency, scenarioTargets.length)

  async function work(): Promise<void> {
    while (nextIndex < scenarioTargets.length) {
      const index = nextIndex++
      const { selection, target } = scenarioTargets[index]!
      runs[index] = await runScenario({
        specification: selection.specification,
        scenario: selection.scenario,
        executionTargetProfile: target.executionTargetProfile,
        adapter: target.adapter,
        plans: input.plans,
        applicationRevision: input.applicationRevision,
        ci: input.ci,
        signal: input.signal,
        retry: input.retry,
        timeout: input.timeout,
        onEvent: input.onEvent
          ? (event) => input.onEvent!(event, selection)
          : undefined,
      })
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => work()))
  return runs
}
