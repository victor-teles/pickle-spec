import type { ScenarioStep } from '@pickle-spec/spec'
import type { ExecutionCacheKey } from './execution-cache'
import {
  type EvidenceAvailability,
  type ExecutionTargetProfile,
  type FidelityPolicy,
  type RunEvent,
  type RunEventPayload,
  type RunEventScope,
  type ScenarioAttempt,
  type ScenarioIdentity,
  type TestArtifact,
  type TestResult,
  type TestStepResult,
  testRunSchemaVersion,
} from './run-scenario'

interface EventResultMappers {
  step(result: TestStepResult): TestStepResult
  attempt(attempt: ScenarioAttempt): ScenarioAttempt
}

type StepResultProjection = (result: TestStepResult) => TestStepResult
type AttemptProjection = (attempt: ScenarioAttempt) => ScenarioAttempt

function publicScenarioIdentity(identity: ScenarioIdentity): ScenarioIdentity {
  return {
    name: identity.name,
    id: identity.id,
    examplesId: identity.examplesId,
    examplesRowId: identity.examplesRowId,
  }
}

function publicExecutionTargetProfile(
  profile: ExecutionTargetProfile,
): ExecutionTargetProfile {
  return {
    id: profile.id,
    adapter: profile.adapter,
    capabilities: profile.capabilities ? [...profile.capabilities] : undefined,
  }
}

function publicScenarioStep(step: ScenarioStep): ScenarioStep {
  return {
    keyword: step.keyword,
    text: step.text,
    type: step.type,
    argument: step.argument
      ? {
          dataTable: step.argument.dataTable?.map((row) => [...row]),
          docString: step.argument.docString,
        }
      : undefined,
  }
}

function publicArtifact(artifact: TestArtifact): TestArtifact {
  return {
    kind: artifact.kind,
    path: artifact.path,
    mediaType: artifact.mediaType,
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

function publicCacheKey(key: ExecutionCacheKey): ExecutionCacheKey {
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

function publicEventScope(scope: RunEventScope): RunEventScope {
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
    resolvedActions: result.resolvedActions.map(({ description }) => ({
      description,
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
    cacheUncacheableReason: attempt.cacheUncacheableReason,
    failureKind: attempt.failureKind,
    message: attempt.message,
    fidelityPolicy: publicFidelityPolicy(attempt.fidelityPolicy),
    evidenceAvailability: attempt.evidenceAvailability.map(
      publicEvidenceAvailability,
    ),
    diagnostics: attempt.diagnostics?.map((entry) => ({ ...entry })),
  }
}

function withoutPrivateScenarioAttemptData(
  attempt: ScenarioAttempt,
): ScenarioAttempt {
  return projectAttempt(attempt, withoutPrivateStepResultData)
}

function recordableScenarioAttempt(attempt: ScenarioAttempt): ScenarioAttempt {
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

function publicEventPayload(
  event: RunEvent | RunEventPayload,
  mappers: EventResultMappers,
): RunEventPayload {
  switch (event.type) {
    case 'run-started':
      return {
        type: 'run-started',
        run: {
          id: event.run.id,
          startedAt: event.run.startedAt,
          sourceRunId: event.run.sourceRunId,
          suite: event.run.suite,
          applicationRevision: event.run.applicationRevision,
        },
      }
    case 'scenario-started':
      return {
        type: 'scenario-started',
        scenario: publicScenarioIdentity(event.scenario),
        executionTargetProfile: publicExecutionTargetProfile(
          event.executionTargetProfile,
        ),
        scope: publicEventScope(event.scope),
      }
    case 'step-started':
      return {
        type: 'step-started',
        step: publicScenarioStep(event.step),
        scenario: publicScenarioIdentity(event.scenario),
        executionTargetProfile: publicExecutionTargetProfile(
          event.executionTargetProfile,
        ),
        scope: publicEventScope(event.scope),
      }
    case 'step-finished':
      return {
        type: 'step-finished',
        result: mappers.step(event.result),
        scenario: publicScenarioIdentity(event.scenario),
        executionTargetProfile: publicExecutionTargetProfile(
          event.executionTargetProfile,
        ),
        scope: publicEventScope(event.scope),
      }
    case 'cache-hit':
    case 'cache-miss':
    case 'cache-refresh':
    case 'replay-diverged':
    case 'adaptive-fallback-started':
    case 'cache-written':
      return {
        type: event.type,
        cacheKey: publicCacheKey(event.cacheKey),
        scope: publicEventScope(event.scope),
      }
    case 'cache-uncacheable':
      return {
        type: 'cache-uncacheable',
        reason: event.reason,
        scope: publicEventScope(event.scope),
      }
    case 'inference-count-updated':
      return {
        type: 'inference-count-updated',
        inferenceCount: event.inferenceCount,
        scope: publicEventScope(event.scope),
      }
    case 'scenario-finished':
      return {
        type: 'scenario-finished',
        specification: {
          name: event.specification.name,
          uri: event.specification.uri,
        },
        scenario: publicScenarioIdentity(event.scenario),
        executionTargetProfile: publicExecutionTargetProfile(
          event.executionTargetProfile,
        ),
        scope: publicEventScope(event.scope),
        attempt: mappers.attempt(event.attempt),
        scheduleIndex: event.scheduleIndex,
      }
    default:
      throw new Error('Unsupported run event type')
  }
}

export function recordableRunEventPayloadData(
  event: RunEventPayload,
): RunEventPayload {
  return publicEventPayload(event, {
    step: withoutPrivateStepResultData,
    attempt: recordableScenarioAttempt,
  })
}

export function publicRunEvent(event: RunEvent): RunEvent {
  return {
    ...publicEventPayload(event, {
      step: withoutPrivateStepResultData,
      attempt: withoutPrivateScenarioAttemptData,
    }),
    schemaVersion: testRunSchemaVersion,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
  } as RunEvent
}
