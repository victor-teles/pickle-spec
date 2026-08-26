import type { TestResult, TestResultState } from '../execution/run-scenario'
import type { TestRunManifest } from './test-run-store'

export interface RerunFilter {
  failures?: boolean
  scenarioIds?: readonly string[]
  scenarioNames?: readonly string[]
  profileIds?: readonly string[]
}

const failureStates = new Set<TestResultState>([
  'failed',
  'infrastructure-error',
])

function matchesOptionalSet(
  value: string | undefined,
  accepted: ReadonlySet<string> | undefined,
): boolean {
  return !accepted || (value !== undefined && accepted.has(value))
}

function matchesRerunFilter(
  result: TestResult,
  hasStateFilter: boolean,
  scenarioIds: ReadonlySet<string> | undefined,
  scenarioNames: ReadonlySet<string> | undefined,
  profileIds: ReadonlySet<string> | undefined,
): boolean {
  if (hasStateFilter && !failureStates.has(result.state)) return false
  return (
    matchesOptionalSet(result.scenario.id, scenarioIds) &&
    matchesOptionalSet(result.scenario.name, scenarioNames) &&
    matchesOptionalSet(result.executionTargetProfile.id, profileIds)
  )
}

export function selectRerunResults(
  manifest: TestRunManifest,
  filter: RerunFilter,
): TestResult[] {
  const hasStateFilter = filter.failures === true
  const scenarioIds = filter.scenarioIds
    ? new Set(filter.scenarioIds)
    : undefined
  const scenarioNames = filter.scenarioNames
    ? new Set(filter.scenarioNames)
    : undefined
  const profileIds = filter.profileIds ? new Set(filter.profileIds) : undefined

  return manifest.results.filter((result) =>
    matchesRerunFilter(
      result,
      hasStateFilter,
      scenarioIds,
      scenarioNames,
      profileIds,
    ),
  )
}
