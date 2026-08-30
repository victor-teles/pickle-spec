import type { ScenarioStep } from '@pickle-spec/spec'
import type {
  ExecutionCacheKey,
  ExecutionCacheUncacheableReason,
} from '../../execution-cache/execution-cache'
import type { ExecutionTargetProfile } from './execution-target-types'
import type {
  ActionEvidence,
  SharedEvidenceObservation,
  testRunSchemaVersion,
} from './run-evidence-types'
import type {
  ScenarioAttempt,
  TestResult,
  TestStepResult,
} from './test-result-types'

interface RunEventEnvelope {
  schemaVersion: typeof testRunSchemaVersion
  sequence: number
  occurredAt: string
}

export interface RunEventScope {
  scenarioId: string
  examplesRowId?: string
  executionTargetProfileId: string
  attempt: number
  stepIndex?: number
}

type RunEventWithObservations<Event extends { type: string }> = Event & {
  observations?: SharedEvidenceObservation[]
}

export type RunEventPayload =
  | RunEventWithObservations<{
      type: 'run-started'
      run: {
        id: string
        startedAt: string
        sourceRunId?: string
        suite?: string
        applicationRevision?: string
        evidencePersistence?: 'off' | 'on-failure' | 'always'
      }
    }>
  | RunEventWithObservations<{
      type: 'scenario-started'
      scenario: TestResult['scenario']
      executionTargetProfile: ExecutionTargetProfile
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'step-started'
      step: ScenarioStep
      scenario: TestResult['scenario']
      executionTargetProfile: ExecutionTargetProfile
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'step-finished'
      result: TestStepResult
      scenario: TestResult['scenario']
      executionTargetProfile: ExecutionTargetProfile
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'action-finished'
      action: ActionEvidence
      scenario: TestResult['scenario']
      executionTargetProfile: ExecutionTargetProfile
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'cache-hit'
      cacheKey: ExecutionCacheKey
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'cache-miss'
      cacheKey: ExecutionCacheKey
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'cache-refresh'
      cacheKey: ExecutionCacheKey
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'replay-diverged'
      cacheKey: ExecutionCacheKey
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'adaptive-fallback-started'
      cacheKey: ExecutionCacheKey
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'cache-written'
      cacheKey: ExecutionCacheKey
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'cache-uncacheable'
      reason: ExecutionCacheUncacheableReason
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'inference-count-updated'
      inferenceCount: number
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'scenario-finished'
      specification: TestResult['specification']
      scenario: TestResult['scenario']
      executionTargetProfile: ExecutionTargetProfile
      scope: RunEventScope
      attempt: ScenarioAttempt
      scheduleIndex?: number
    }>

export type RunEvent = RunEventEnvelope & RunEventPayload
