import type { ScenarioStep } from '@pickle-spec/spec'
import {
  type ActionEvidence,
  type EvidenceAvailability,
  type ExecutionTargetProfile,
  type FidelityPolicy,
  type RunEventScope,
  type ScenarioAttempt,
  type ScenarioIdentity,
  type SharedEvidenceObservation,
  type TestArtifact,
  type TestResult,
  type TestStepResult,
  testRunSchemaVersion,
} from '../../execution/run-scenario'
import type { ExecutionCacheKey } from '../../execution-cache/execution-cache'

type StepResultProjection = (result: TestStepResult) => TestStepResult
type AttemptProjection = (attempt: ScenarioAttempt) => ScenarioAttempt

export function publicScenarioIdentity(
  identity: ScenarioIdentity,
): ScenarioIdentity {
  return {
    name: identity.name,
    id: identity.id,
    examplesId: identity.examplesId,
    examplesRowId: identity.examplesRowId,
  }
}

export function publicExecutionTargetProfile(
  profile: ExecutionTargetProfile,
): ExecutionTargetProfile {
  return {
    id: profile.id,
    adapter: profile.adapter,
    capabilities: profile.capabilities ? [...profile.capabilities] : undefined,
  }
}

export function publicScenarioStep(step: ScenarioStep): ScenarioStep {
  return {
    keyword: step.keyword,
    text: step.text,
    type: step.type,
    source: step.source ? { ...step.source } : undefined,
    argument: step.argument
      ? {
          dataTable: step.argument.dataTable?.map((row) => [...row]),
          docString: step.argument.docString,
        }
      : undefined,
  }
}

export function publicActionEvidence(action: ActionEvidence): ActionEvidence {
  const screenshot = (
    value: ActionEvidence['screenshots']['before'],
  ): ActionEvidence['screenshots']['before'] =>
    value.state === 'available'
      ? { state: 'available', artifact: publicArtifact(value.artifact) }
      : { ...value }
  return {
    ...action,
    source: { ...action.source },
    target: {
      before: { ...action.target.before },
      after: { ...action.target.after },
    },
    screenshots: {
      before: screenshot(action.screenshots.before),
      after: screenshot(action.screenshots.after),
    },
    diagnostics: action.diagnostics.map((entry) => ({ ...entry })),
    activity: action.activity.map((entry) => ({ ...entry })),
  }
}

function publicArtifact(artifact: TestArtifact): TestArtifact {
  return {
    kind: artifact.kind,
    path: artifact.path,
    mediaType: artifact.mediaType,
    name: artifact.name,
    capturedAt: artifact.capturedAt,
    sizeBytes: artifact.sizeBytes,
    evidenceLink: artifact.evidenceLink
      ? {
          stepIndex: artifact.evidenceLink.stepIndex,
          eventRange: { ...artifact.evidenceLink.eventRange },
        }
      : undefined,
  }
}

export function publicSharedEvidenceObservation(
  observation: SharedEvidenceObservation,
): SharedEvidenceObservation {
  return {
    version: observation.version,
    kind: observation.kind,
    summary: observation.summary,
    timing: {
      occurredAt: observation.timing.occurredAt,
      precision: observation.timing.precision,
      startedAt: observation.timing.startedAt,
      finishedAt: observation.timing.finishedAt,
      durationMs: observation.timing.durationMs,
      causalAt: observation.timing.causalAt,
    },
    versions: observation.versions?.map((entry) => ({
      subject: entry.subject,
      label: entry.label,
      value: entry.value,
    })),
    activity: observation.activity
      ? {
          kind: observation.activity.kind,
          description: observation.activity.description,
        }
      : undefined,
    outcome: observation.outcome
      ? {
          state: observation.outcome.state,
          level: observation.outcome.level,
          message: observation.outcome.message,
        }
      : undefined,
    cost: observation.cost
      ? { inferenceCount: observation.cost.inferenceCount }
      : undefined,
    artifact: observation.artifact
      ? publicArtifact(observation.artifact)
      : undefined,
    execution: observation.execution
      ? {
          mode: observation.execution.mode,
          cacheOutcome: observation.execution.cacheOutcome,
          cacheDecision: observation.execution.cacheDecision
            ? {
                type: observation.execution.cacheDecision.type,
                reason: observation.execution.cacheDecision.reason,
                cacheKey: observation.execution.cacheDecision.cacheKey
                  ? publicCacheKey(observation.execution.cacheDecision.cacheKey)
                  : undefined,
              }
            : undefined,
        }
      : undefined,
  }
}

function publicEvidenceAvailability(
  availability: EvidenceAvailability,
): EvidenceAvailability {
  return {
    kind: availability.kind,
    state: availability.state,
    message: availability.message,
  }
}

function publicFidelityPolicy(
  policy: FidelityPolicy | undefined,
): FidelityPolicy | undefined {
  if (!policy) return undefined
  return { profile: policy.profile, tradeOffs: [...policy.tradeOffs] }
}

export function publicCacheKey(key: ExecutionCacheKey): ExecutionCacheKey {
  return {
    projectKey: key.projectKey,
    scenarioId: key.scenarioId,
    scenarioRevision: key.scenarioRevision,
    executionTargetProfileId: key.executionTargetProfileId,
    targetConfigurationFingerprint: key.targetConfigurationFingerprint,
    applicationRevision: key.applicationRevision,
    adapterKind: key.adapterKind,
    adapterCacheSchemaVersion: key.adapterCacheSchemaVersion,
  }
}

export function publicEventScope(scope: RunEventScope): RunEventScope {
  return {
    scenarioId: scope.scenarioId,
    examplesRowId: scope.examplesRowId,
    executionTargetProfileId: scope.executionTargetProfileId,
    attempt: scope.attempt,
    stepIndex: scope.stepIndex,
  }
}

export function withoutPrivateStepResultData(
  result: TestStepResult,
): TestStepResult {
  return {
    index: result.index,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    step: publicScenarioStep(result.step),
    state: result.state,
    resolvedActions: result.resolvedActions.map((action) => ({
      description: action.description,
      evidence: action.evidence
        ? publicActionEvidence(action.evidence)
        : undefined,
    })),
    message: result.message,
    artifacts: result.artifacts?.map(publicArtifact),
    diagnostics: result.diagnostics?.map((entry) => ({ ...entry })),
    trace: result.trace?.map((entry) => ({ ...entry })),
  }
}

function projectAttempt(
  attempt: ScenarioAttempt,
  projectStep: StepResultProjection,
): ScenarioAttempt {
  return {
    attempt: attempt.attempt,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    durationMs: attempt.durationMs,
    state: attempt.state,
    steps: attempt.steps.map(projectStep),
    executionMode: attempt.executionMode,
    cacheOutcome: attempt.cacheOutcome,
    inferenceCount: attempt.inferenceCount,
    prefixStepCount: attempt.prefixStepCount,
    cacheUncacheableReason: attempt.cacheUncacheableReason,
    failureKind: attempt.failureKind,
    message: attempt.message,
    fidelityPolicy: publicFidelityPolicy(attempt.fidelityPolicy),
    evidenceAvailability: attempt.evidenceAvailability.map(
      publicEvidenceAvailability,
    ),
    applicationOutputAvailability: attempt.applicationOutputAvailability?.map(
      (availability) => ({ ...availability }),
    ),
    diagnostics: attempt.diagnostics?.map((entry) => ({ ...entry })),
  }
}

export function withoutPrivateScenarioAttemptData(
  attempt: ScenarioAttempt,
): ScenarioAttempt {
  return projectAttempt(attempt, withoutPrivateStepResultData)
}

export function recordableScenarioAttempt(
  attempt: ScenarioAttempt,
): ScenarioAttempt {
  return {
    ...withoutPrivateScenarioAttemptData(attempt),
    executionMode: attempt.executionMode ?? 'adaptive',
    cacheOutcome: attempt.cacheOutcome ?? 'uncacheable',
    inferenceCount: attempt.inferenceCount ?? 0,
  }
}

function projectTestResult(
  result: TestResult,
  projectAttemptData: AttemptProjection,
): TestResult {
  return {
    schemaVersion: testRunSchemaVersion,
    specification: {
      name: result.specification.name,
      uri: result.specification.uri,
    },
    scenario: publicScenarioIdentity(result.scenario),
    executionTargetProfile: publicExecutionTargetProfile(
      result.executionTargetProfile,
    ),
    state: result.state,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    attempts: result.attempts.map(projectAttemptData),
    flaky: result.flaky,
  }
}

export function withoutPrivateTestResultData(result: TestResult): TestResult {
  return projectTestResult(result, withoutPrivateScenarioAttemptData)
}

export function recordableTestResult(result: TestResult): TestResult {
  return projectTestResult(result, recordableScenarioAttempt)
}

export function publicTestResult(result: TestResult): TestResult {
  return projectTestResult(result, withoutPrivateScenarioAttemptData)
}
