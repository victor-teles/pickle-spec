import { z } from 'zod'
import {
  actionEvidenceVersion,
  diagnosticLevels,
  sharedEvidenceCacheDecisionTypes,
  sharedEvidenceObservationVersion,
  traceActivityKinds,
} from '../../execution/run-scenario'
import {
  artifactSchema,
  cacheOutcomeSchema,
  cacheUncacheableReasonSchema,
  diagnosticEntrySchema,
  executionCacheKeySchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
  resultStateSchema,
  timestampSchema,
  traceEntrySchema,
  validateTiming,
} from './run-schema-primitives'

const actionTargetStateSchema = z.object({
  format: z.literal('summary'),
  summary: z.string().max(2_000),
  location: z.string().max(2_048).optional(),
})

const actionScreenshotSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('available'), artifact: artifactSchema }),
  z.object({
    state: z.enum([
      'not-requested',
      'not-supported',
      'not-retained',
      'capture-failed',
      'missing',
    ]),
    message: z.string().optional(),
  }),
])

export const actionEvidenceSchema = z
  .object({
    version: z.literal(actionEvidenceVersion),
    id: z.string().min(1),
    ordinal: nonNegativeIntegerSchema,
    description: z.string(),
    startedAt: timestampSchema,
    finishedAt: timestampSchema,
    durationMs: nonNegativeIntegerSchema,
    state: z.enum(['passed', 'failed']),
    message: z.string().optional(),
    source: z.object({
      uri: z.string(),
      language: z.string(),
      line: positiveIntegerSchema.optional(),
      column: positiveIntegerSchema.optional(),
      excerpt: z.string(),
    }),
    target: z.object({
      before: actionTargetStateSchema,
      after: actionTargetStateSchema,
    }),
    screenshots: z.object({
      before: actionScreenshotSchema,
      after: actionScreenshotSchema,
    }),
    diagnostics: z.array(diagnosticEntrySchema),
    activity: z.array(traceEntrySchema),
  })
  .superRefine(validateTiming)

export const resolvedActionSchema = z.object({
  description: z.string(),
  replay: z.record(z.string(), z.unknown()).optional(),
  evidence: actionEvidenceSchema.optional(),
})

const sharedEvidenceTimingSchema = z.object({
  occurredAt: timestampSchema,
  precision: z.enum(['exact', 'step-finish', 'attempt-finish']),
  startedAt: timestampSchema.optional(),
  finishedAt: timestampSchema.optional(),
  durationMs: nonNegativeIntegerSchema.optional(),
  causalAt: timestampSchema.optional(),
})

const sharedEvidenceVersionObservationSchema = z.object({
  subject: z.enum(['contract', 'application', 'scenario', 'adapter']),
  label: z.string(),
  value: z.string(),
})

const sharedEvidenceActivitySchema = z.object({
  kind: z.enum(traceActivityKinds),
  description: z.string(),
})

const sharedEvidenceOutcomeSchema = z.object({
  state: resultStateSchema.optional(),
  level: z.enum(diagnosticLevels).optional(),
  message: z.string().optional(),
})

const sharedEvidenceCostSchema = z.object({
  inferenceCount: nonNegativeIntegerSchema,
})

export const sharedEvidenceObservationSchema = z.object({
  version: z.literal(sharedEvidenceObservationVersion),
  kind: z.enum(['activity', 'diagnostic', 'artifact', 'outcome', 'cache']),
  summary: z.string(),
  timing: sharedEvidenceTimingSchema,
  versions: z.array(sharedEvidenceVersionObservationSchema).optional(),
  activity: sharedEvidenceActivitySchema.optional(),
  outcome: sharedEvidenceOutcomeSchema.optional(),
  cost: sharedEvidenceCostSchema.optional(),
  artifact: artifactSchema.optional(),
  execution: z
    .object({
      mode: z.enum(['adaptive', 'replay']).optional(),
      cacheOutcome: cacheOutcomeSchema.optional(),
      cacheDecision: z
        .object({
          type: z.enum(sharedEvidenceCacheDecisionTypes),
          reason: cacheUncacheableReasonSchema.optional(),
          cacheKey: executionCacheKeySchema.optional(),
        })
        .optional(),
    })
    .optional(),
})
