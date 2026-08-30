import {
  type RunEvent,
  type RunEventPayload,
  type ScenarioAttempt,
  type TestStepResult,
  testRunSchemaVersion,
} from '../../execution/run-scenario'
import {
  publicActionEvidence,
  publicCacheKey,
  publicEventScope,
  publicExecutionTargetProfile,
  publicScenarioIdentity,
  publicScenarioStep,
  publicSharedEvidenceObservation,
  recordableScenarioAttempt,
  withoutPrivateScenarioAttemptData,
  withoutPrivateStepResultData,
} from './public-result-data'

interface EventResultMappers {
  step(result: TestStepResult): TestStepResult
  attempt(attempt: ScenarioAttempt): ScenarioAttempt
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
