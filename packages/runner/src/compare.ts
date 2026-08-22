import type { TestResult } from './run-scenario'
import type { TestRunManifest } from './test-run-store'

export type ResultChangeKind =
  | 'state'
  | 'duration'
  | 'flaky'
  | 'execution-mode'
  | 'cache-outcome'
  | 'inference-count'
  | 'resolved-actions'
  | 'artifacts'

export interface ComparedResultPair {
  scenarioId: string
  executionTargetProfileId: string
  baseline: TestResult
  candidate: TestResult
  changes: ResultChangeKind[]
}

export interface ComparedResultSide {
  scenarioId: string
  executionTargetProfileId: string
  result: TestResult
}

export interface TestRunComparison {
  schemaVersion: 1
  baselineRunId: string
  candidateRunId: string
  pairs: ComparedResultPair[]
  removed: ComparedResultSide[]
  added: ComparedResultSide[]
}

function scenarioIdOf(result: TestResult): string {
  return result.scenario.id ?? result.scenario.name
}

function artifactSignature(result: TestResult): string {
  return JSON.stringify(
    result.steps.flatMap((step) =>
      (step.artifacts ?? []).map((artifact) => ({
        kind: artifact.kind,
        path: artifact.path,
      })),
    ),
  )
}

function resolvedActionsSignature(result: TestResult): string {
  return JSON.stringify(result.steps.map((step) => step.resolvedActions))
}

function changesBetween(
  baseline: TestResult,
  candidate: TestResult,
): ResultChangeKind[] {
  const changes: ResultChangeKind[] = []
  if (baseline.state !== candidate.state) changes.push('state')
  if (
    baseline.durationMs !== undefined &&
    candidate.durationMs !== undefined &&
    baseline.durationMs !== candidate.durationMs
  ) {
    changes.push('duration')
  }
  if (Boolean(baseline.flaky) !== Boolean(candidate.flaky)) {
    changes.push('flaky')
  }
  if (baseline.executionMode !== candidate.executionMode) {
    changes.push('execution-mode')
  }
  if (baseline.cacheOutcome !== candidate.cacheOutcome) {
    changes.push('cache-outcome')
  }
  if (baseline.inferenceCount !== candidate.inferenceCount) {
    changes.push('inference-count')
  }
  if (
    resolvedActionsSignature(baseline) !== resolvedActionsSignature(candidate)
  ) {
    changes.push('resolved-actions')
  }
  if (artifactSignature(baseline) !== artifactSignature(candidate)) {
    changes.push('artifacts')
  }
  return changes
}

function findMatch(
  available: Set<TestResult>,
  candidate: TestResult,
): TestResult | undefined {
  for (const baseline of available) {
    const sameProfile =
      baseline.executionTargetProfile.id === candidate.executionTargetProfile.id
    const sameScenario =
      baseline.scenario.id && candidate.scenario.id
        ? baseline.scenario.id === candidate.scenario.id
        : baseline.scenario.name === candidate.scenario.name
    if (sameProfile && sameScenario) {
      available.delete(baseline)
      return baseline
    }
  }
  return undefined
}

export function compareTestRuns(
  baseline: TestRunManifest,
  candidate: TestRunManifest,
): TestRunComparison {
  const available = new Set(baseline.results)
  const pairs: ComparedResultPair[] = []
  const added: ComparedResultSide[] = []

  for (const candidateResult of candidate.results) {
    const baselineResult = findMatch(available, candidateResult)
    if (!baselineResult) {
      added.push({
        scenarioId: scenarioIdOf(candidateResult),
        executionTargetProfileId: candidateResult.executionTargetProfile.id,
        result: candidateResult,
      })
      continue
    }
    const changes = changesBetween(baselineResult, candidateResult)
    if (changes.length > 0) {
      pairs.push({
        scenarioId: scenarioIdOf(baselineResult),
        executionTargetProfileId: baselineResult.executionTargetProfile.id,
        baseline: baselineResult,
        candidate: candidateResult,
        changes,
      })
    }
  }

  const removed: ComparedResultSide[] = [...available.keys()].map((result) => ({
    scenarioId: scenarioIdOf(result),
    executionTargetProfileId: result.executionTargetProfile.id,
    result,
  }))

  return {
    schemaVersion: 1,
    baselineRunId: baseline.id,
    candidateRunId: candidate.id,
    pairs,
    removed,
    added,
  }
}
