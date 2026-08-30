import type { ScenarioStep } from '@pickle-spec/spec'
import {
  type ActionEvidence,
  type EvidenceAvailability,
  type ExecutionTargetProfile,
  type FidelityPolicy,
  type RunEvent,
  type RunEventPayload,
  type RunEventScope,
  type ScenarioAttempt,
  type ScenarioIdentity,
  type SharedEvidenceObservation,
  type TestArtifact,
  type TestResult,
  type TestStepResult,
  testRunSchemaVersion,
} from '../execution/run-scenario'
import type { ExecutionCacheKey } from '../execution-cache/execution-cache'

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
    source: step.source ? { ...step.source } : undefined,
    argument: step.argument
      ? {
          dataTable: step.argument.dataTable?.map((row) => [...row]),
          docString: step.argument.docString,
        }
      : undefined,
  }
}

function publicActionEvidence(action: ActionEvidence): ActionEvidence {
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

function publicSharedEvidenceObservation(
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
      ? {
          inferenceCount: observation.cost.inferenceCount,
        }
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

function publicScenarioStartedEvent(
  event: Extract<RunEventPayload, { type: 'scenario-started' }>,
): RunEventPayload {
  return {
    type: 'scenario-started',
    scenario: publicScenarioIdentity(event.scenario),
    executionTargetProfile: publicExecutionTargetProfile(
      event.executionTargetProfile,
    ),
    scope: publicEventScope(event.scope),
  }
}

function publicStepStartedEvent(
  event: Extract<RunEventPayload, { type: 'step-started' }>,
): RunEventPayload {
  return {
    type: 'step-started',
    step: publicScenarioStep(event.step),
    scenario: publicScenarioIdentity(event.scenario),
    executionTargetProfile: publicExecutionTargetProfile(
      event.executionTargetProfile,
    ),
    scope: publicEventScope(event.scope),
  }
}

function publicScenarioFinishedEvent(
  event: Extract<RunEventPayload, { type: 'scenario-finished' }>,
  mappers: EventResultMappers,
): RunEventPayload {
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
}

function publicRunStartedEvent(
  event: Extract<RunEventPayload, { type: 'run-started' }>,
): RunEventPayload {
  return {
    type: 'run-started',
    run: {
      id: event.run.id,
      startedAt: event.run.startedAt,
      sourceRunId: event.run.sourceRunId,
      suite: event.run.suite,
      applicationRevision: event.run.applicationRevision,
      evidencePersistence: event.run.evidencePersistence,
    },
  }
}

function publicStepFinishedEvent(
  event: Extract<RunEventPayload, { type: 'step-finished' }>,
  mappers: EventResultMappers,
): RunEventPayload {
  return {
    type: 'step-finished',
    result: mappers.step(event.result),
    scenario: publicScenarioIdentity(event.scenario),
    executionTargetProfile: publicExecutionTargetProfile(
      event.executionTargetProfile,
    ),
    scope: publicEventScope(event.scope),
  }
}

function publicActionFinishedEvent(
  event: Extract<RunEventPayload, { type: 'action-finished' }>,
): RunEventPayload {
  return {
    type: 'action-finished',
    action: publicActionEvidence(event.action),
    scenario: publicScenarioIdentity(event.scenario),
    executionTargetProfile: publicExecutionTargetProfile(
      event.executionTargetProfile,
    ),
    scope: publicEventScope(event.scope),
  }
}

function publicCacheEvent(
  event: Extract<
    RunEventPayload,
    {
      type:
        | 'cache-hit'
        | 'cache-miss'
        | 'cache-refresh'
        | 'replay-diverged'
        | 'adaptive-fallback-started'
        | 'cache-written'
    }
  >,
): RunEventPayload {
  return {
    type: event.type,
    cacheKey: publicCacheKey(event.cacheKey),
    scope: publicEventScope(event.scope),
  }
}

function publicInferenceCountUpdatedEvent(
  event: Extract<RunEventPayload, { type: 'inference-count-updated' }>,
): RunEventPayload {
  return {
    type: 'inference-count-updated',
    inferenceCount: event.inferenceCount,
    scope: publicEventScope(event.scope),
  }
}

function withObservations(
  event: RunEvent | RunEventPayload,
  payload: RunEventPayload,
): RunEventPayload {
  return event.observations?.length
    ? {
        ...payload,
        observations: event.observations.map(publicSharedEvidenceObservation),
      }
    : payload
}

function publicEventPayload(
  event: RunEvent | RunEventPayload,
  mappers: EventResultMappers,
): RunEventPayload {
  switch (event.type) {
    case 'run-started':
      return withObservations(event, publicRunStartedEvent(event))
    case 'scenario-started':
      return withObservations(event, publicScenarioStartedEvent(event))
    case 'step-started':
      return withObservations(event, publicStepStartedEvent(event))
    case 'step-finished':
      return withObservations(event, publicStepFinishedEvent(event, mappers))
    case 'action-finished':
      return withObservations(event, publicActionFinishedEvent(event))
    case 'cache-hit':
    case 'cache-miss':
    case 'cache-refresh':
    case 'replay-diverged':
    case 'adaptive-fallback-started':
    case 'cache-written':
      return withObservations(event, publicCacheEvent(event))
    case 'cache-uncacheable':
      return withObservations(event, {
        type: 'cache-uncacheable',
        reason: event.reason,
        scope: publicEventScope(event.scope),
      })
    case 'inference-count-updated':
      return withObservations(event, publicInferenceCountUpdatedEvent(event))
    case 'scenario-finished':
      return withObservations(
        event,
        publicScenarioFinishedEvent(event, mappers),
      )
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
