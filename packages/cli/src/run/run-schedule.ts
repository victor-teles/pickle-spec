import type {
  RunEvent,
  ScheduledTestResult,
  TestResult,
} from '@pickle-spec/runner'
import { groupResults } from './run-report'

export type PendingSpecificationBlock = {
  uri: string
  scheduleIndexes: number[]
}

export type ScheduleIndexQueue = {
  indexes: number[]
  next: number
}

export function groupSchedule(
  schedule: readonly ScheduledTestResult[],
): PendingSpecificationBlock[] {
  const blocks = new Map<string, PendingSpecificationBlock>()
  schedule.forEach((result, scheduleIndex) => {
    let block = blocks.get(result.specification.uri)
    if (!block) {
      block = { uri: result.specification.uri, scheduleIndexes: [] }
      blocks.set(result.specification.uri, block)
    }
    block.scheduleIndexes.push(scheduleIndex)
  })
  return [...blocks.values()].sort((left, right) =>
    left.uri.localeCompare(right.uri),
  )
}

export function orderedScheduleFromResults(
  results: readonly TestResult[],
): ScheduledTestResult[] {
  return groupResults(results).flatMap((specification) =>
    [...specification.scenarios.values()].flatMap((scenario) =>
      scenario.results.map((result) => ({
        specification: result.specification,
        scenario: result.scenario,
        executionTargetProfile: result.executionTargetProfile,
      })),
    ),
  )
}

function scheduledResultKey(result: ScheduledTestResult | TestResult): string {
  const scenarioIdentity = result.scenario.id ?? result.scenario.name
  const rowIdentity = result.scenario.examplesRowId ?? ''
  return `${result.specification.uri}\0${scenarioIdentity}\0${rowIdentity}\0${result.executionTargetProfile.id}`
}

export function createScheduleIndexQueues(
  schedule: readonly ScheduledTestResult[],
): Map<string, ScheduleIndexQueue> {
  const queues = new Map<string, ScheduleIndexQueue>()
  schedule.forEach((result, index) => {
    const key = scheduledResultKey(result)
    const queue = queues.get(key) ?? { indexes: [], next: 0 }
    queue.indexes.push(index)
    queues.set(key, queue)
  })
  return queues
}

export function claimScheduleIndex(
  queues: ReadonlyMap<string, ScheduleIndexQueue>,
  result: TestResult,
): number | undefined {
  const queue = queues.get(scheduledResultKey(result))
  if (!queue) {
    throw new Error(
      `Completed unscheduled Scenario "${result.scenario.name}" for execution target profile "${result.executionTargetProfile.id}"`,
    )
  }
  return queue.indexes[queue.next++]
}

export function scheduledEventMatches(
  scheduled: ScheduledTestResult,
  event: Extract<
    RunEvent,
    { type: 'scenario-started' | 'step-started' | 'step-finished' }
  >,
): boolean {
  if (!event.scenario) return false
  const scenarioMatches = event.scenario.id
    ? event.scenario.id === scheduled.scenario.id &&
      event.scenario.examplesRowId === scheduled.scenario.examplesRowId
    : event.scenario.name === scheduled.scenario.name
  const profileMatches = event.executionTargetProfile
    ? event.executionTargetProfile.id === scheduled.executionTargetProfile.id
    : true
  return scenarioMatches && profileMatches
}
