import { z } from 'zod'
import {
  type RunEvent,
  testRunSchemaVersion,
} from '../../execution/run-scenario-types'

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
import { planUseSchema } from '../../execution-plans/execution-plan-revision'

const eventEnvelope = {
  schemaVersion: z.union([z.literal(testRunSchemaVersion), z.literal(3)]),
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

function eventPlanUse(event: RunEvent) {
  let planUse
  if (event.type === 'scenario-started') planUse = event.planUse
  if (event.type === 'scenario-finished') planUse = event.attempt.planUse
  return planUse
}

export const runEventSchema: z.ZodType<RunEvent> = z
  .discriminatedUnion('type', [
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
      planUse: planUseSchema.optional(),
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
  ])
  .superRefine((event, context) => {
    const planUse = eventPlanUse(event)
    const lifecycleEvent =
      event.type === 'scenario-started' || event.type === 'scenario-finished'
    if (event.schemaVersion === 2 && planUse) {
      context.addIssue({
        code: 'custom',
        message: 'Plan use requires run evidence schema version 3',
      })
    }
    if (event.schemaVersion === 3 && lifecycleEvent && !planUse) {
      context.addIssue({
        code: 'custom',
        message: 'Schema-v3 Scenario lifecycle events require Plan use',
      })
    }
  })
