import type { TestResult, TestResultState } from './run-scenario'
import type { TestRunManifest } from './test-run-store'

export interface RerunFilter {
  failures?: boolean
  adaptations?: boolean
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
  const hasStateFilter = Boolean(filter.failures || filter.adaptations)
  const scenarioIds = filter.scenarioIds
    ? new Set(filter.scenarioIds)
    : undefined
  const scenarioNames = filter.scenarioNames
    ? new Set(filter.scenarioNames)
    : undefined
  const profileIds = filter.profileIds ? new Set(filter.profileIds) : undefined

  return manifest.results.filter((result) => {
    if (hasStateFilter) {
      const matchesFailure =
        filter.failures === true && failureStates.has(result.state)
      const matchesAdaptation =
        filter.adaptations === true && result.state === 'passed-with-adaptation'
      if (!matchesFailure && !matchesAdaptation) return false
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
