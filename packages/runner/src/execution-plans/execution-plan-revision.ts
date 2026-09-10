import { z } from 'zod'
import type { ExecutionCacheKey } from '../execution-cache/execution-cache'

export type Digest = string
export type PlanScope = Readonly<Omit<ExecutionCacheKey, 'projectKey'>>
export type JsonPrimitive = boolean | null | number | string
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface Actor {
  kind: 'human' | 'agent'
  id: string
}

export interface RunReference {
  projectKey: string
  runId: string
  resultDigest: Digest
}

export interface StepIdentity {
  scenarioRevision: string
  index: number
}

export type PlanOrigin =
  | { kind: 'capture'; sourceRun: RunReference; payloadDigest: Digest }
  | { kind: 'cache-capture'; payloadDigest: Digest }
  | { kind: 'revision'; revisionId: Digest }

export interface PlanRevision {
  formatVersion: 1
  id: Digest
  scope: PlanScope
  origin: PlanOrigin
  author: Actor
  createdAt: string
  requiredVariables: readonly string[]
  steps: readonly StepIdentity[]
  adapterPayload: unknown
  assertionBaselineRevisionId: Digest | null
}

export interface IntentReview {
  reviewer: { kind: 'human'; id: string }
  candidateId: Digest
  baselineId: Digest
  scenarioRevision: string
  decision: 'preserves-specification'
  rationale: string
  evidenceRunIds: readonly string[]
}

export interface ValidationReceipt {
  id: Digest
  revisionId: Digest
  key: ExecutionCacheKey
  inputSnapshotDigest: Digest
  assertionDigest: Digest
  intentReviewDigest: Digest
  validationRun: RunReference
  adapterValidatorVersion: string
  validatedAt: string
  result: 'passed'
  inferenceCount: 0
}

export interface ValidationHead {
  basisDigest: Digest
  generation: number
  run: RunReference
  outcome: 'passed' | 'failed' | 'cancelled'
  receiptId: Digest | null
}

export type PlanUse = {
  revisionId: Digest
  selectionDigest: Digest | null
  key: ExecutionCacheKey
  payloadDigest: Digest
  author: Actor
  origin: PlanOrigin
} & (
  | { purpose: 'validation'; validationId: null }
  | { purpose: 'active'; validationId: Digest }
)

export type PlanRevisionContent = Omit<PlanRevision, 'id'>

export interface PlanSelection {
  formatVersion: 1
  generation: number
  active: { revisionId: Digest } | null
  createdAt: string
  previousSelectionDigest: Digest | null
  actor: Actor
  reason: 'activate' | 'rollback' | 'deactivate'
}

export type PlanUnavailableReason =
  | 'unsupported-format'
  | 'unsupported-adapter'
  | 'invalid-payload'
  | 'missing-revision'
  | 'inapplicable'
  | 'incomplete-plan'
  | 'assertion-change'
  | 'specification-review-required'
  | 'validation-required'
  | 'stale-validation'
  | 'write-conflict'
  | 'refresh-conflicts-with-active-plan'
  | 'validation-failed'
  | 'cancelled'

export type PlanResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: PlanUnavailableReason; message: string }

const nonemptyString = z.string().refine((value) => value.trim().length > 0)
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/)
const variableNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/)

const actorSchema = z.strictObject({
  kind: z.enum(['human', 'agent']),
  id: nonemptyString,
})

const runReferenceSchema = z.strictObject({
  projectKey: nonemptyString,
  runId: nonemptyString,
  resultDigest: digestSchema,
})

const planOriginSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('capture'),
    sourceRun: runReferenceSchema,
    payloadDigest: digestSchema,
  }),
  z.strictObject({
    kind: z.literal('cache-capture'),
    payloadDigest: digestSchema,
  }),
  z.strictObject({
    kind: z.literal('revision'),
    revisionId: digestSchema,
  }),
])

const planScopeSchema = z.strictObject({
  scenarioId: nonemptyString,
  scenarioRevision: nonemptyString,
  executionTargetProfileId: nonemptyString,
  targetConfigurationFingerprint: nonemptyString,
  applicationRevision: nonemptyString,
  adapterKind: nonemptyString,
  adapterCacheSchemaVersion: nonemptyString,
})

const planUseBaseSchema = z.strictObject({
  revisionId: digestSchema,
  selectionDigest: digestSchema.nullable(),
  key: planScopeSchema.extend({ projectKey: nonemptyString }),
  payloadDigest: digestSchema,
  author: actorSchema,
  origin: planOriginSchema,
})

export const intentReviewSchema: z.ZodType<IntentReview> = z.strictObject({
  reviewer: z.strictObject({ kind: z.literal('human'), id: nonemptyString }),
  candidateId: digestSchema,
  baselineId: digestSchema,
  scenarioRevision: nonemptyString,
  decision: z.literal('preserves-specification'),
  rationale: nonemptyString,
  evidenceRunIds: z.array(nonemptyString),
})

export const validationReceiptSchema: z.ZodType<ValidationReceipt> =
  z.strictObject({
    id: digestSchema,
    revisionId: digestSchema,
    key: planUseBaseSchema.shape.key,
    inputSnapshotDigest: digestSchema,
    assertionDigest: digestSchema,
    intentReviewDigest: digestSchema,
    validationRun: runReferenceSchema,
    adapterValidatorVersion: nonemptyString,
    validatedAt: nonemptyString,
    result: z.literal('passed'),
    inferenceCount: z.literal(0),
  })

export const validationHeadSchema: z.ZodType<ValidationHead> = z.strictObject({
  basisDigest: digestSchema,
  generation: z.number().int().positive().safe(),
  run: runReferenceSchema,
  outcome: z.enum(['passed', 'failed', 'cancelled']),
  receiptId: digestSchema.nullable(),
})

export const planUseSchema = z.discriminatedUnion('purpose', [
  planUseBaseSchema.extend({
    purpose: z.literal('validation'),
    validationId: z.null(),
  }),
  planUseBaseSchema.extend({
    purpose: z.literal('active'),
    validationId: digestSchema,
  }),
])

const stepIdentitySchema = z.strictObject({
  scenarioRevision: nonemptyString,
  index: z.number().int().nonnegative().safe(),
})

const uniqueStrings = (values: readonly string[]) =>
  new Set(values).size === values.length

const uniqueSteps = (steps: readonly StepIdentity[]) => {
  const identities = steps.map(
    (step) => `${step.scenarioRevision}\u0000${step.index}`,
  )
  return new Set(identities).size === identities.length
}

export const planRevisionContentSchema = z.strictObject({
  formatVersion: z.literal(1),
  scope: planScopeSchema,
  origin: planOriginSchema,
  author: actorSchema,
  createdAt: nonemptyString,
  requiredVariables: z.array(variableNameSchema).refine(uniqueStrings),
  steps: z.array(stepIdentitySchema).refine(uniqueSteps),
  adapterPayload: z.unknown(),
  assertionBaselineRevisionId: digestSchema.nullable(),
})

export const planRevisionSchema = planRevisionContentSchema.extend({
  id: digestSchema,
})

export const planSelectionSchema = z
  .strictObject({
    formatVersion: z.literal(1),
    generation: z.number().int().positive().safe(),
    active: z.strictObject({ revisionId: digestSchema }).nullable(),
    createdAt: nonemptyString,
    previousSelectionDigest: digestSchema.nullable(),
    actor: actorSchema,
    reason: z.enum(['activate', 'rollback', 'deactivate']),
  })
  .refine((selection) =>
    selection.reason === 'deactivate'
      ? selection.active === null
      : selection.active !== null,
  )

export function isDigest(value: string): boolean {
  return digestSchema.safeParse(value).success
}
