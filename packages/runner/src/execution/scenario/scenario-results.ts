import { persistedEvidenceKinds } from '../../evidence/evidence'
import { requiredValue } from '../../required-value'
import type {
  DiagnosticEntry,
  EvidenceAvailability,
  ExecutionMode,
  RunEventPayload,
  RunScenarioInput,
  ScenarioAttempt,
  ScenarioAttemptInput,
  TestResult,
  TestResultState,
  TestStepResult,
} from '../run-scenario-types'
import { evidenceKinds, testRunSchemaVersion } from '../run-scenario-types'
import { scenarioDefinitionId, scenarioIdentity } from './scenario-runtime'

const evidenceCapabilities = {
  screenshot: 'screenshots',
  trace: 'traces',
  recording: 'recordings',
  'device-log': 'device-logs',
  diagnostics: 'diagnostics',
} as const

export function attemptEvidence(
  input: ScenarioAttemptInput,
  steps: readonly TestStepResult[],
  reported: readonly EvidenceAvailability[] = [],
  diagnostics: readonly DiagnosticEntry[] = [],
): EvidenceAvailability[] {
  const available = persistedEvidenceKinds(steps, diagnostics)
  const capabilities = new Set(
    input.executionTargetProfile.capabilities ?? input.adapter.capabilities,
  )
  return evidenceKinds.map((kind) => {
    if (available.has(kind)) {
      return { kind, state: 'available' }
    }
    const adapterAvailability = reported.findLast(
      (availability) => availability.kind === kind,
    )
    return (
      adapterAvailability ?? {
        kind,
        state: capabilities.has(evidenceCapabilities[kind])
          ? 'not-requested'
          : 'not-supported',
      }
    )
  })
}

export function createTestResult(
  input: ScenarioAttemptInput,
  attempts: ScenarioAttempt[],
): TestResult {
  const first = attempts[0]
  const final = attempts.at(-1)
  if (!first || !final) {
    throw new Error('A Test result requires at least one Scenario attempt')
  }
  const scenarioId = scenarioDefinitionId(input.specification, input.scenario)
  return {
    schemaVersion: testRunSchemaVersion,
    specification: {
      name: input.specification.name,
      uri: input.specification.source.uri,
    },
    scenario: { ...scenarioIdentity(input.scenario), id: scenarioId },
    executionTargetProfile: input.executionTargetProfile,
    state: final.state,
    startedAt: first.startedAt,
    finishedAt: final.finishedAt,
    durationMs: durationMs(first.startedAt, final.finishedAt),
    attempts,
    ...(attempts.length > 1 && final.state === 'passed' ? { flaky: true } : {}),
  }
}

export function createSyntheticTestResult(
  input: RunScenarioInput,
  mode: ExecutionMode,
  state: TestResultState,
  message?: string,
): TestResult {
  const occurredAt = (input.now ?? (() => new Date()))().toISOString()
  const attemptInput: ScenarioAttemptInput = {
    ...input,
    mode,
    attempt: 1,
  }
  const attempt: ScenarioAttempt = {
    attempt: 1,
    startedAt: occurredAt,
    finishedAt: occurredAt,
    durationMs: 0,
    state,
    steps: [],
    executionMode: mode,
    inferenceCount: 0,
    ...(input.adapter.fidelityPolicy
      ? { fidelityPolicy: input.adapter.fidelityPolicy }
      : {}),
    ...(message !== undefined ? { message } : {}),
    evidenceAvailability: attemptEvidence(attemptInput, []),
  }
  return createTestResult(attemptInput, [attempt])
}

export function withFinalAttempt(
  result: TestResult,
  update: Partial<ScenarioAttempt>,
): TestResult {
  const attempts = result.attempts.map((attempt, index) =>
    index === result.attempts.length - 1 ? { ...attempt, ...update } : attempt,
  )
  const final = requiredValue(attempts.at(-1))
  return {
    ...result,
    state: final.state,
    finishedAt: final.finishedAt,
    durationMs: durationMs(result.startedAt, final.finishedAt),
    attempts,
    flaky: attempts.length > 1 && final.state === 'passed' ? true : undefined,
  }
}

export function scenarioFinishedPayload(result: TestResult): RunEventPayload {
  const attempt = result.attempts.at(-1)
  if (!attempt) throw new Error('A Test result requires a Scenario attempt')
  return {
    type: 'scenario-finished',
    specification: result.specification,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: {
      scenarioId: requiredValue(result.scenario.id),
      examplesRowId: result.scenario.examplesRowId,
      executionTargetProfileId: result.executionTargetProfile.id,
      attempt: attempt.attempt,
    },
    attempt,
  }
}

export function durationMs(startedAt: string, finishedAt: string): number {
  return Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
}
