import { z } from 'zod'

export interface ExecutionCacheKeyInput {
  projectKey: string
  scenarioId: string
  scenarioRevision: string
  executionTargetProfileId: string
  targetConfigurationFingerprint: string
  applicationRevision?: string
  adapterKind: string
  adapterCacheSchemaVersion: string
}

export interface ExecutionCacheKey extends ExecutionCacheKeyInput {
  applicationRevision: string
}

export interface ExecutionCacheEnvelope<AdapterPayload = unknown> {
  schemaVersion: 1
  key: ExecutionCacheKey
  requiredVariables: string[]
  adapterPayload: AdapterPayload
}

export interface ExecutionCachePayloadValidator<AdapterPayload = unknown> {
  adapterKind: string
  adapterCacheSchemaVersion: string
  parse(
    payload: unknown,
    requiredVariables: readonly string[],
  ): AdapterPayload | undefined
}

export interface ExecutionCacheAdapter<AdapterPayload = unknown>
  extends ExecutionCachePayloadValidator<AdapterPayload> {
  targetConfigurationFingerprint: string
}

declare const serializedExecutionCacheEnvelope: unique symbol
declare const serializedExecutionCacheTerminalOutcome: unique symbol

export type SerializedExecutionCacheEnvelope = {
  readonly key: ExecutionCacheKey
  readonly source: string
  readonly [serializedExecutionCacheEnvelope]: true
}

export type ExecutionCacheTerminalOutcome = {
  state:
    | 'passed'
    | 'passed-with-adaptation'
    | 'failed'
    | 'skipped'
    | 'infrastructure-error'
  cacheOutcome: Exclude<CacheOutcome, 'hit'>
  cacheUncacheableReason?: ExecutionCacheUncacheableReason
  failureKind?: 'cache-miss'
}

export type SerializedExecutionCacheTerminalOutcome = {
  readonly source: string
  readonly [serializedExecutionCacheTerminalOutcome]: true
}

export interface ExecutionCacheLease {
  key: ExecutionCacheKey
  ownerToken: string
  baselineRevision?: number
  heartbeatMs: number
}

export interface ExecutionCacheEntrySnapshot {
  source: string
  revision: number
}

export type ExecutionCacheLeaseAcquisition =
  | { acquired: true; lease: ExecutionCacheLease }
  | {
      acquired: false
      ownerToken: string
      baselineRevision?: number
    }

export type ExecutionCacheLeaseWaitResult =
  | {
      status: 'released'
      published: boolean
      terminalOutcome?: SerializedExecutionCacheTerminalOutcome
    }
  | { status: 'timed-out' | 'cancelled' }

export interface ExecutionCacheLeasePublicationResult
  extends ExecutionCacheWriteResult {
  published: boolean
}

export interface ExecutionCacheCoordination {
  readCurrent(
    key: ExecutionCacheKey,
  ): Promise<ExecutionCacheEntrySnapshot | undefined>
  acquire(key: ExecutionCacheKey): Promise<ExecutionCacheLeaseAcquisition>
  renew(lease: ExecutionCacheLease): Promise<boolean>
  wait(
    key: ExecutionCacheKey,
    ownerToken: string,
    baselineRevision: number | undefined,
    signal?: AbortSignal,
  ): Promise<ExecutionCacheLeaseWaitResult>
  publish(
    lease: ExecutionCacheLease,
    serializedEnvelope: SerializedExecutionCacheEnvelope,
    metadata: ExecutionCacheWriteMetadata,
  ): Promise<ExecutionCacheLeasePublicationResult>
  complete(
    lease: ExecutionCacheLease,
    terminalOutcome: SerializedExecutionCacheTerminalOutcome,
  ): Promise<boolean>
  release(lease: ExecutionCacheLease): Promise<void>
}

export interface ExecutionCacheStore {
  read(key: ExecutionCacheKey): Promise<string | undefined>
  write(
    serializedEnvelope: SerializedExecutionCacheEnvelope,
    metadata: ExecutionCacheWriteMetadata,
  ): Promise<ExecutionCacheWriteResult>
  delete(key: ExecutionCacheKey): Promise<void>
  inspect(): Promise<ExecutionCacheEntryMetadata[]>
  clear(): Promise<void>
  coordination?: ExecutionCacheCoordination
}

const terminalCacheOutcomeValues = [
  'miss',
  'refresh',
  'fallback',
  'uncacheable',
] as const

export type CacheOutcome = 'hit' | (typeof terminalCacheOutcomeValues)[number]

const executionCacheUncacheableReasonValues = [
  'application-revision-missing',
  'bound-parameter-value',
  'non-deterministic-action',
  'non-deterministic-assertion',
  'payload-validation-failed',
  'entry-too-large',
] as const

export type ExecutionCacheUncacheableReason =
  (typeof executionCacheUncacheableReasonValues)[number]

export interface ExecutionCacheWriteMetadata {
  sourceRunId: string
  evaluationModel?: string
  evaluationInferenceCount: number
}

export interface ExecutionCacheEntryMetadata
  extends ExecutionCacheWriteMetadata {
  key: ExecutionCacheKey
  createdAt: string
  lastUsedAt: string
  hitCount: number
  payloadDigest: string
  sizeBytes: number
}

export interface ExecutionCacheWriteResult {
  stored: boolean
  evictedEntries: number
}

export interface DeserializeExecutionCacheEnvelopeInput<AdapterPayload> {
  source: string
  expectedKey: ExecutionCacheKey
  payloadValidator: ExecutionCachePayloadValidator<AdapterPayload>
}

const nonemptyString = z.string().refine((value) => value.trim().length > 0)
const variableName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/)

const executionCacheKeyInputSchema = z.strictObject({
  projectKey: nonemptyString,
  scenarioId: nonemptyString,
  scenarioRevision: nonemptyString,
  executionTargetProfileId: nonemptyString,
  targetConfigurationFingerprint: nonemptyString,
  applicationRevision: z.string().optional(),
  adapterKind: nonemptyString,
  adapterCacheSchemaVersion: nonemptyString,
})

const executionCacheKeySchema = executionCacheKeyInputSchema.extend({
  applicationRevision: nonemptyString,
})

const executionCacheEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  key: executionCacheKeySchema,
  requiredVariables: z.array(variableName),
  adapterPayload: z.unknown(),
})

const executionCacheTerminalOutcomeSchema = z.strictObject({
  state: z.enum([
    'passed',
    'passed-with-adaptation',
    'failed',
    'skipped',
    'infrastructure-error',
  ]),
  cacheOutcome: z.enum(terminalCacheOutcomeValues),
  cacheUncacheableReason: z
    .enum(executionCacheUncacheableReasonValues)
    .optional(),
  failureKind: z.literal('cache-miss').optional(),
})

export function serializeExecutionCacheTerminalOutcome(
  outcome: ExecutionCacheTerminalOutcome,
): SerializedExecutionCacheTerminalOutcome {
  const parsed = executionCacheTerminalOutcomeSchema.parse(outcome)
  return Object.freeze({
    source: JSON.stringify(parsed),
  }) as SerializedExecutionCacheTerminalOutcome
}

export function deserializeExecutionCacheTerminalOutcome(
  serialized: SerializedExecutionCacheTerminalOutcome,
): ExecutionCacheTerminalOutcome | undefined {
  try {
    return executionCacheTerminalOutcomeSchema.safeParse(
      JSON.parse(serialized.source) as unknown,
    ).data
  } catch {
    return undefined
  }
}

function invalidKeyMessage(error: z.ZodError): string {
  const unsupported = error.issues.find(
    (issue) => issue.code === 'unrecognized_keys',
  )
  if (unsupported?.code === 'unrecognized_keys') {
    return unsupported.keys
      .map((key) => `${key} is not supported in an Execution cache key`)
      .join('\n')
  }
  return 'Execution cache key fields must be non-empty strings'
}

export function resolveExecutionCacheKey(
  input: ExecutionCacheKeyInput,
): ExecutionCacheKey | undefined {
  const parsed = executionCacheKeyInputSchema.safeParse(input)
  if (!parsed.success) throw new Error(invalidKeyMessage(parsed.error))
  if (!parsed.data.applicationRevision?.trim()) return undefined
  return parsed.data as ExecutionCacheKey
}

function keysEqual(left: ExecutionCacheKey, right: ExecutionCacheKey): boolean {
  return (
    left.projectKey === right.projectKey &&
    left.scenarioId === right.scenarioId &&
    left.scenarioRevision === right.scenarioRevision &&
    left.executionTargetProfileId === right.executionTargetProfileId &&
    left.targetConfigurationFingerprint ===
      right.targetConfigurationFingerprint &&
    left.applicationRevision === right.applicationRevision &&
    left.adapterKind === right.adapterKind &&
    left.adapterCacheSchemaVersion === right.adapterCacheSchemaVersion
  )
}

function hasUniqueVariables(requiredVariables: readonly string[]): boolean {
  return new Set(requiredVariables).size === requiredVariables.length
}

function parseAdapterPayload<AdapterPayload>(
  envelope: ExecutionCacheEnvelope,
  validator: ExecutionCachePayloadValidator<AdapterPayload>,
): AdapterPayload | undefined {
  if (
    envelope.key.adapterKind !== validator.adapterKind ||
    envelope.key.adapterCacheSchemaVersion !==
      validator.adapterCacheSchemaVersion
  ) {
    return undefined
  }
  try {
    return validator.parse(envelope.adapterPayload, envelope.requiredVariables)
  } catch {
    return undefined
  }
}

function parseEnvelope(value: unknown): ExecutionCacheEnvelope | undefined {
  const parsed = executionCacheEnvelopeSchema.safeParse(value)
  if (!parsed.success || !hasUniqueVariables(parsed.data.requiredVariables)) {
    return undefined
  }
  return parsed.data as ExecutionCacheEnvelope
}

function validatedEnvelope<AdapterPayload>(
  envelope: ExecutionCacheEnvelope,
  validator: ExecutionCachePayloadValidator<AdapterPayload>,
): ExecutionCacheEnvelope<AdapterPayload> | undefined {
  const adapterPayload = parseAdapterPayload(envelope, validator)
  if (adapterPayload === undefined) return undefined
  return { ...envelope, adapterPayload }
}

export function serializeExecutionCacheEnvelope<AdapterPayload>(
  envelope: ExecutionCacheEnvelope,
  payloadValidator: ExecutionCachePayloadValidator<AdapterPayload>,
): SerializedExecutionCacheEnvelope {
  const parsed = parseEnvelope(envelope)
  if (!parsed) {
    throw new Error('Execution cache envelope is not cacheable')
  }
  const validated = validatedEnvelope(parsed, payloadValidator)
  if (!validated) {
    throw new Error('Execution cache adapter payload is not cacheable')
  }
  return Object.freeze({
    key: Object.freeze({ ...validated.key }),
    source: JSON.stringify(validated),
  }) as SerializedExecutionCacheEnvelope
}

export function deserializeExecutionCacheEnvelope<AdapterPayload>(
  input: DeserializeExecutionCacheEnvelopeInput<AdapterPayload>,
): ExecutionCacheEnvelope<AdapterPayload> | undefined {
  let value: unknown
  try {
    value = JSON.parse(input.source) as unknown
  } catch {
    return undefined
  }
  const parsed = parseEnvelope(value)
  if (!parsed) return undefined
  const envelope = validatedEnvelope(parsed, input.payloadValidator)
  if (!envelope || !keysEqual(envelope.key, input.expectedKey)) return undefined
  return envelope
}
