import type { ScenarioStep } from '@pickle-spec/spec'
import type { ExecutionCacheKey } from './execution-cache'
import type {
  ExecutionTargetProfile,
  FidelityPolicy,
  RunEvent,
  RunEventPayload,
  ScenarioIdentity,
  TestArtifact,
  TestResult,
  TestResultState,
  TestStepResult,
} from './run-scenario'

interface EventResultMappers {
  step(result: TestStepResult): TestStepResult
  scenario(result: TestResult): TestResult
}

type StepResultProjection = (result: TestStepResult) => TestStepResult

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

export function withoutPrivateStepResultData(
  result: TestStepResult,
): TestStepResult {
  return {
    step: publicScenarioStep(result.step),
    state: result.state,
    resolvedActions: result.resolvedActions.map(({ description }) => ({
      description,
    })),
    message: result.message,
    artifacts: result.artifacts?.map(publicArtifact),
  }
}

function projectTestResult(
  result: TestResult,
  state: TestResultState,
  projectStep: StepResultProjection,
): TestResult {
  return {
    schemaVersion: 1,
    specification: {
      name: result.specification.name,
      uri: result.specification.uri,
    },
    scenario: publicScenarioIdentity(result.scenario),
    executionTargetProfile: publicExecutionTargetProfile(
      result.executionTargetProfile,
    ),
    state,
    steps: result.steps.map(projectStep),
    executionMode: result.executionMode,
    cacheOutcome: result.cacheOutcome,
    inferenceCount: result.inferenceCount,
    cacheUncacheableReason: result.cacheUncacheableReason,
    failureKind: result.failureKind,
    message: result.message,
    attempts: result.attempts,
    flaky: result.flaky,
    durationMs: result.durationMs,
    fidelityPolicy: publicFidelityPolicy(result.fidelityPolicy),
  }
}

export function withoutPrivateTestResultData(result: TestResult): TestResult {
  return projectTestResult(result, result.state, withoutPrivateStepResultData)
}

export function recordableTestResult(result: TestResult): TestResult {
  return {
    ...withoutPrivateTestResultData(result),
    executionMode: result.executionMode ?? 'adaptive',
    cacheOutcome: result.cacheOutcome ?? 'uncacheable',
    inferenceCount: result.inferenceCount ?? 0,
  }
}

function publicStepResult(result: TestStepResult): TestStepResult {
  return withoutPrivateStepResultData(result)
}

export function publicTestResult(result: TestResult): TestResult {
  return projectTestResult(result, result.state, publicStepResult)
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
        executionTargetProfile: event.executionTargetProfile
          ? publicExecutionTargetProfile(event.executionTargetProfile)
          : undefined,
      }
    case 'step-started':
      return {
        type: 'step-started',
        step: publicScenarioStep(event.step),
        scenario: event.scenario
          ? publicScenarioIdentity(event.scenario)
          : undefined,
        executionTargetProfile: event.executionTargetProfile
          ? publicExecutionTargetProfile(event.executionTargetProfile)
          : undefined,
      }
    case 'step-finished':
      return {
        type: 'step-finished',
        result: mappers.step(event.result),
        scenario: event.scenario
          ? publicScenarioIdentity(event.scenario)
          : undefined,
        executionTargetProfile: event.executionTargetProfile
          ? publicExecutionTargetProfile(event.executionTargetProfile)
          : undefined,
      }
    case 'cache-hit':
    case 'cache-miss':
    case 'cache-refresh':
    case 'replay-diverged':
    case 'adaptive-fallback-started':
    case 'cache-written':
      return { type: event.type, cacheKey: publicCacheKey(event.cacheKey) }
    case 'cache-uncacheable':
      return { type: 'cache-uncacheable', reason: event.reason }
    case 'inference-count-updated':
      return {
        type: 'inference-count-updated',
        inferenceCount: event.inferenceCount,
      }
    case 'scenario-finished':
      return {
        type: 'scenario-finished',
        result: mappers.scenario(event.result),
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
    scenario: recordableTestResult,
  })
}

export function publicRunEvent(event: RunEvent): RunEvent {
  return {
    ...publicEventPayload(event, {
      step: publicStepResult,
      scenario: publicTestResult,
    }),
    schemaVersion: 1,
    sequence: event.sequence,
  } as RunEvent
}
