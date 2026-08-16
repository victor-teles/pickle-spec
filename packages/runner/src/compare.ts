import type { TestResult } from './run-scenario'
import type { TestRunManifest } from './test-run-store'

export type ResultChangeKind =
  | 'state'
  | 'duration'
  | 'flaky'
  | 'adaptation'
  | 'plan'
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

function identityKeys(result: TestResult): string[] {
  const profileId = result.executionTargetProfile.id
  const keys = [`name:${result.scenario.name}::${profileId}`]
  if (result.scenario.id) {
    keys.unshift(`id:${result.scenario.id}::${profileId}`)
  }
  return keys
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

function planSignature(result: TestResult): string {
  return JSON.stringify({
    executionMode: result.executionMode,
    steps: result.steps.map((step) => step.resolvedActions),
  })
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
  const baselineAdapted = baseline.state === 'passed-with-adaptation'
  const candidateAdapted = candidate.state === 'passed-with-adaptation'
  if (baselineAdapted !== candidateAdapted) changes.push('adaptation')
  if (planSignature(baseline) !== planSignature(candidate)) {
    changes.push('plan')
  }
  if (artifactSignature(baseline) !== artifactSignature(candidate)) {
    changes.push('artifacts')
  }
  return changes
}

function findMatch(
  available: Map<TestResult, string[]>,
  candidate: TestResult,
): TestResult | undefined {
  const candidateKeys = new Set(identityKeys(candidate))
  for (const [baseline, keys] of available) {
    if (keys.some((key) => candidateKeys.has(key))) {
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
  const available = new Map(
    baseline.results.map((result) => [result, identityKeys(result)] as const),
  )
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
