import type { TestRunSummary } from '@pickle-spec/runner'
import type {
  StudioProject,
  StudioRunReadiness,
  StudioRunRequest,
  StudioRunsIndex,
  StudioScenario,
  StudioSpecification,
} from '../../server/contracts'
import type { StudioReadinessAttempt } from '../runs/use-live-run'

export type FirstRunTarget = {
  readiness: StudioRunReadiness
  request: StudioRunRequest
  scenario: StudioScenario
  specification: StudioSpecification
}

export type FirstRunOnboardingState =
  | { kind: 'complete'; run: TestRunSummary }
  | { kind: 'empty-project' }
  | { kind: 'blocked'; target: FirstRunTarget }
  | { kind: 'ready'; target: FirstRunTarget }
  | { kind: 'running'; target: FirstRunTarget }
  | { kind: 'failed'; run: TestRunSummary; target: FirstRunTarget }

type FirstRunOnboardingInput = {
  activeProfileId?: string
  currentSpecification?: StudioSpecification
  readinessAttempt?: StudioReadinessAttempt
  project: StudioProject
  running: boolean
  runsIndex?: StudioRunsIndex
}

function sameValues(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (!left || !right) return left === right
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function sameStudioRunRequest(
  left: StudioRunRequest,
  right: StudioRunRequest,
): boolean {
  return (
    left.suite === right.suite &&
    sameValues(left.profiles, right.profiles) &&
    sameValues(left.paths, right.paths) &&
    left.scenarioName === right.scenarioName &&
    left.scenarioId === right.scenarioId &&
    left.rerunId === right.rerunId &&
    left.failures === right.failures &&
    left.refreshCache === right.refreshCache
  )
}

function scenarioReadiness(
  project: StudioProject,
  specification: StudioSpecification,
  scenario: StudioScenario,
): StudioRunReadiness {
  return (
    scenario.readiness ?? {
      ready:
        scenario.canRun ??
        specification.canRun ??
        project.readiness?.ready ??
        true,
      reasons: specification.runReasons ?? project.readiness?.reasons ?? [],
    }
  )
}

function targetFrom(
  input: FirstRunOnboardingInput,
  specification: StudioSpecification,
  scenario: StudioScenario,
): FirstRunTarget {
  const request: StudioRunRequest = {
    paths: [specification.uri],
    scenarioId: scenario.id,
    profiles: input.activeProfileId ? [input.activeProfileId] : undefined,
  }
  const attempted = input.readinessAttempt
  return {
    readiness:
      attempted && sameStudioRunRequest(attempted.request, request)
        ? attempted.readiness
        : scenarioReadiness(input.project, specification, scenario),
    request,
    scenario,
    specification,
  }
}

function prioritizedSpecifications(
  project: StudioProject,
  current: StudioSpecification | undefined,
): StudioSpecification[] {
  if (!current) return [...project.specifications]
  return [
    current,
    ...project.specifications.filter(
      (specification) => specification.id !== current.id,
    ),
  ]
}

export function firstRunTarget(
  input: FirstRunOnboardingInput,
): FirstRunTarget | undefined {
  const specifications = prioritizedSpecifications(
    input.project,
    input.currentSpecification,
  )
  for (const specification of specifications) {
    const scenario = specification.scenarios.find(
      (candidate) =>
        scenarioReadiness(input.project, specification, candidate).ready,
    )
    if (scenario) return targetFrom(input, specification, scenario)
  }
  const specification = specifications.find(
    (candidate) => candidate.scenarios.length > 0,
  )
  const scenario = specification?.scenarios[0]
  return specification && scenario
    ? targetFrom(input, specification, scenario)
    : undefined
}

function latestFailedRun(
  runs: readonly TestRunSummary[],
): TestRunSummary | undefined {
  return runs.find(
    (run) => run.state === 'failed' || run.state === 'infrastructure-error',
  )
}

export function firstRunOnboardingState(
  input: FirstRunOnboardingInput,
): FirstRunOnboardingState {
  const runs = input.runsIndex?.runs ?? []
  const passed = runs.find((run) => run.state === 'passed')
  if (passed) return { kind: 'complete', run: passed }
  const target = firstRunTarget(input)
  if (!target) return { kind: 'empty-project' }
  if (input.running) return { kind: 'running', target }
  if (!target.readiness.ready) return { kind: 'blocked', target }
  const failed = latestFailedRun(runs)
  if (failed) return { kind: 'failed', run: failed, target }
  return { kind: 'ready', target }
}
