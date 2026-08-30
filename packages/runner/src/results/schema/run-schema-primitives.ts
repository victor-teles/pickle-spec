import { z } from 'zod'
import {
  diagnosticLevels,
  diagnosticOrigins,
  traceActivityKinds,
} from '../../execution/run-scenario'

export const resultStateSchema = z.enum(
  ['passed', 'failed', 'skipped', 'cancelled', 'infrastructure-error'],
  { error: 'Test result state must be a current result state' },
)

export const nonNegativeIntegerSchema = z.number().int().nonnegative().safe()
export const positiveIntegerSchema = z.number().int().positive().safe()
export const timestampSchema = z.iso.datetime({ offset: true })

export const cacheOutcomeSchema = z.enum([
  'hit',
  'partial-hit',
  'miss',
  'refresh',
  'fallback',
  'uncacheable',
])

export const cacheUncacheableReasonSchema = z.enum([
  'application-revision-missing',
  'bound-parameter-value',
  'non-deterministic-action',
  'non-deterministic-assertion',
  'payload-validation-failed',
  'entry-too-large',
])

export const evidenceStateSchema = z.enum([
  'available',
  'not-requested',
  'not-supported',
  'not-retained',
  'capture-failed',
  'missing',
])

interface TimedEvidence {
  startedAt: string
  finishedAt: string
  durationMs: number
}

export function validateTiming(
  value: TimedEvidence,
  context: z.RefinementCtx,
): void {
  const elapsedMs = Date.parse(value.finishedAt) - Date.parse(value.startedAt)
  if (elapsedMs < 0) {
    context.addIssue({
      code: 'custom',
      path: ['finishedAt'],
      message: 'finishedAt must not precede startedAt',
    })
  }
  if (value.durationMs !== Math.max(0, elapsedMs)) {
    context.addIssue({
      code: 'custom',
      path: ['durationMs'],
      message: 'durationMs must match startedAt and finishedAt',
    })
  }
}

export const scenarioStepSchema = z.object({
  keyword: z.string(),
  text: z.string(),
  type: z.enum(['context', 'action', 'outcome']),
  source: z
    .object({
      line: positiveIntegerSchema,
      column: positiveIntegerSchema,
      excerpt: z.string(),
    })
    .optional(),
  argument: z
    .object({
      dataTable: z.array(z.array(z.string())).optional(),
      docString: z.string().optional(),
    })
    .optional(),
})

export const artifactSchema = z.object({
  kind: z.enum(['screenshot', 'trace', 'recording', 'device-log']),
  path: z.string(),
  mediaType: z.string().optional(),
  name: z.string().min(1).optional(),
  capturedAt: timestampSchema.optional(),
  sizeBytes: nonNegativeIntegerSchema.optional(),
  evidenceLink: z
    .object({
      stepIndex: nonNegativeIntegerSchema,
      eventRange: z.object({
        startSequence: nonNegativeIntegerSchema,
        endSequence: nonNegativeIntegerSchema,
      }),
    })
    .optional(),
})

export const diagnosticEntrySchema = z.object({
  occurredAt: timestampSchema,
  causalAt: timestampSchema.optional(),
  level: z.enum(diagnosticLevels),
  origin: z.enum(diagnosticOrigins),
  stream: z.enum(['stdout', 'stderr']).optional(),
  message: z.string(),
  scenarioId: z.string().optional(),
  scenarioName: z.string().optional(),
  stepIndex: nonNegativeIntegerSchema.optional(),
  stepText: z.string().optional(),
  executionTargetProfileId: z.string().optional(),
})

export const traceEntrySchema = z.object({
  occurredAt: timestampSchema,
  causalAt: timestampSchema.optional(),
  kind: z.enum(traceActivityKinds),
  description: z.string(),
})

export const executionCacheKeySchema = z.object({
  projectKey: z.string(),
  scenarioId: z.string(),
  scenarioRevision: z.string(),
  executionTargetProfileId: z.string(),
  targetConfigurationFingerprint: z.string(),
  applicationRevision: z.string(),
  adapterKind: z.string(),
  adapterCacheSchemaVersion: z.string(),
})

export const specificationIdentitySchema = z.object({
  name: z.string(),
  uri: z.string(),
})

export const scenarioIdentitySchema = z.object({
  name: z.string(),
  id: z.string(),
  examplesId: z.string().optional(),
  examplesRowId: z.string().optional(),
})

export const executionTargetProfileSchema = z.object({
  id: z.string(),
  adapter: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
})

export const runEventScopeSchema = z.object({
  scenarioId: z.string(),
  examplesRowId: z.string().optional(),
  executionTargetProfileId: z.string(),
  attempt: positiveIntegerSchema,
  stepIndex: nonNegativeIntegerSchema.optional(),
})
