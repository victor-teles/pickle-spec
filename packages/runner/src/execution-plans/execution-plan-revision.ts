import { z } from 'zod'
import type { ExecutionCacheKey } from '../execution-cache/execution-cache'

export type Digest = string
export type PlanScope = Readonly<Omit<ExecutionCacheKey, 'projectKey'>>

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
