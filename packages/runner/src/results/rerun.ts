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

  return manifest.results.filter((result) => {
    if (hasStateFilter) {
      if (!failureStates.has(result.state)) return false
    }
    if (
      scenarioIds &&
      (!result.scenario.id || !scenarioIds.has(result.scenario.id))
    ) {
      return false
    }
    if (scenarioNames && !scenarioNames.has(result.scenario.name)) {
      return false
    }
    if (profileIds && !profileIds.has(result.executionTargetProfile.id)) {
      return false
    }
    return true
  })
}
