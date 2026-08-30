import type {
  RunEvent,
  ScenarioAttempt,
  TestResult,
  TestResultState,
} from '../../execution/run-scenario'
import { testRunSchemaVersion } from '../../execution/run-scenario'

const stateRank: Record<TestResultState, number> = {
  skipped: 0,
  passed: 1,
  cancelled: 2,
  failed: 3,
  'infrastructure-error': 4,
}

export function startedAtFrom(
  events: readonly RunEvent[],
  fallback: string,
): string {
  const started = events.find((event) => event.type === 'run-started')
  return started?.type === 'run-started' ? started.run.startedAt : fallback
}

interface MaterializedResultGroup {
  order: number
  specification: TestResult['specification']
  scenario: TestResult['scenario']
  executionTargetProfile: TestResult['executionTargetProfile']
  attempts: Map<number, ScenarioAttempt>
}

function collectResultGroups(
  events: readonly RunEvent[],
): Map<string, MaterializedResultGroup> {
  const groups = new Map<string, MaterializedResultGroup>()
  for (const event of events) {
    if (event.type !== 'scenario-finished') continue
    const key = [
      event.scope.scenarioId,
      event.scope.examplesRowId ?? '',
      event.scope.executionTargetProfileId,
    ].join('\u0000')
    const group = groups.get(key) ?? {
      order: event.scheduleIndex ?? Number.MAX_SAFE_INTEGER,
      specification: event.specification,
      scenario: event.scenario,
      executionTargetProfile: event.executionTargetProfile,
      attempts: new Map<number, ScenarioAttempt>(),
    }
    group.order = Math.min(
      group.order,
      event.scheduleIndex ?? Number.MAX_SAFE_INTEGER,
    )
    if (group.attempts.has(event.attempt.attempt)) {
      throw new Error(
        `Duplicate Scenario attempt ${event.attempt.attempt} for ` +
          `Scenario "${event.scenario.name}" and execution target ` +
          `profile "${event.executionTargetProfile.id}"`,
      )
    }
    group.attempts.set(event.attempt.attempt, event.attempt)
    groups.set(key, group)
  }
  return groups
}

function materializedResult(group: MaterializedResultGroup): TestResult {
  const attempts = [...group.attempts.values()].sort(
    (left, right) => left.attempt - right.attempt,
  )
  const first = attempts[0]
  const final = attempts.at(-1)
  if (!first || !final) {
    throw new Error('A Test result requires at least one Scenario attempt')
  }
  return {
    schemaVersion: testRunSchemaVersion,
    specification: group.specification,
    scenario: group.scenario,
    executionTargetProfile: group.executionTargetProfile,
    state: final.state,
    startedAt: first.startedAt,
    finishedAt: final.finishedAt,
    durationMs: Math.max(
      0,
      Date.parse(final.finishedAt) - Date.parse(first.startedAt),
    ),
    attempts,
    ...(attempts.length > 1 && final.state === 'passed' ? { flaky: true } : {}),
  }
}

export function materializeTestResults(
  events: readonly RunEvent[],
): TestResult[] {
  return [...collectResultGroups(events).values()]
    .sort(
      (left, right) =>
        left.order - right.order ||
        (left.scenario.id ?? left.scenario.name).localeCompare(
          right.scenario.id ?? right.scenario.name,
        ),
    )
    .map(materializedResult)
}

export function aggregateTestResultState(
  results: readonly TestResult[],
): TestResultState {
  return results.reduce<TestResultState>(
    (state, result) =>
      stateRank[result.state] > stateRank[state] ? result.state : state,
    'skipped',
  )
}
