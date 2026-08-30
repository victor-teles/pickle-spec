import { z } from 'zod'
import type { RunEvent } from '../../execution/run-scenario'
import { testRunSchemaVersion } from '../../execution/run-scenario'
import {
  actionEvidenceSchema,
  sharedEvidenceObservationSchema,
} from './run-evidence-schema'
import {
  cacheUncacheableReasonSchema,
  executionCacheKeySchema,
  executionTargetProfileSchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
  runEventScopeSchema,
  scenarioIdentitySchema,
  scenarioStepSchema,
  specificationIdentitySchema,
  timestampSchema,
} from './run-schema-primitives'
import {
  scenarioAttemptSchema,
  testStepResultSchema,
} from './test-result-schema'

const eventEnvelope = {
  schemaVersion: z.literal(testRunSchemaVersion),
  sequence: positiveIntegerSchema,
  occurredAt: timestampSchema,
  observations: z.array(sharedEvidenceObservationSchema).optional(),
}

const scopedEvent = {
  scenario: scenarioIdentitySchema,
  executionTargetProfile: executionTargetProfileSchema,
  scope: runEventScopeSchema,
}

const cacheEventTypes = [
  'cache-hit',
  'cache-miss',
  'cache-refresh',
  'replay-diverged',
  'adaptive-fallback-started',
  'cache-written',
] as const

const cacheEventSchemas = cacheEventTypes.map((type) =>
  z.object({
    ...eventEnvelope,
    type: z.literal(type),
    cacheKey: executionCacheKeySchema,
    scope: runEventScopeSchema,
  }),
)

export const runEventSchema: z.ZodType<RunEvent> = z.discriminatedUnion(
  'type',
  [
    z.object({
      ...eventEnvelope,
      type: z.literal('run-started'),
      run: z.object({
        id: z.string(),
        startedAt: timestampSchema,
        sourceRunId: z.string().optional(),
        suite: z.string().optional(),
        applicationRevision: z.string().optional(),
        evidencePersistence: z.enum(['off', 'on-failure', 'always']).optional(),
      }),
    }),
    z.object({
      ...eventEnvelope,
      ...scopedEvent,
      type: z.literal('scenario-started'),
    }),
    z.object({
      ...eventEnvelope,
      ...scopedEvent,
      type: z.literal('step-started'),
      step: scenarioStepSchema,
    }),
    z.object({
      ...eventEnvelope,
      ...scopedEvent,
      type: z.literal('step-finished'),
      result: testStepResultSchema,
    }),
    z.object({
      ...eventEnvelope,
      ...scopedEvent,
      type: z.literal('action-finished'),
      action: actionEvidenceSchema,
    }),
    ...cacheEventSchemas,
    z.object({
      ...eventEnvelope,
      type: z.literal('cache-uncacheable'),
      scope: runEventScopeSchema,
      reason: cacheUncacheableReasonSchema,
    }),
    z.object({
      ...eventEnvelope,
      type: z.literal('inference-count-updated'),
      scope: runEventScopeSchema,
      inferenceCount: nonNegativeIntegerSchema,
    }),
    z.object({
      ...eventEnvelope,
      ...scopedEvent,
      type: z.literal('scenario-finished'),
      specification: specificationIdentitySchema,
      attempt: scenarioAttemptSchema,
      scheduleIndex: nonNegativeIntegerSchema.optional(),
    }),
  ],
)
