import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import {
  deserializeExecutionCacheEnvelope,
  type ExecutionCacheEntryMetadata,
  type ExecutionCacheEnvelope,
  type ExecutionCachePayloadValidator,
  type ExecutionCacheStore,
  publicRunEvent,
  type RunEventPayload,
  resolveExecutionCacheKey,
  serializeExecutionCacheEnvelope,
} from '../../../index'
import type { ScenarioAttempt } from '../../../src/execution/run-scenario'
import { withSharedEvidenceObservations } from '../../../src/results/shared-evidence-observations'

const keyInput = {
  projectKey: 'project-fingerprint',
  scenarioId: 'checkout-purchase',
  scenarioRevision: 'scenario-revision',
  executionTargetProfileId: 'chromium',
  targetConfigurationFingerprint: 'target-fingerprint',
  applicationRevision: 'application-revision',
  adapterKind: 'contract-test',
  adapterCacheSchemaVersion: 'contract-test.1',
}

const payloadSchema = z.strictObject({
  operation: z.literal('fill'),
  argument: z.strictObject({ variable: z.string() }),
})

type TestPayload = z.infer<typeof payloadSchema>

const eventScope = {
  scenarioId: 'checkout-purchase',
  executionTargetProfileId: 'chromium',
  attempt: 1,
}

const payloadValidator: ExecutionCachePayloadValidator<TestPayload> = {
  adapterKind: 'contract-test',
  adapterCacheSchemaVersion: 'contract-test.1',
  parse(payload, requiredVariables) {
    const parsed = payloadSchema.safeParse(payload)
    if (!parsed.success) return
    if (!requiredVariables.includes(parsed.data.argument.variable)) {
      return
    }
    return parsed.data
  },
  prefixStepCount() {
    return 1
  },
}

function envelope(): ExecutionCacheEnvelope<TestPayload> {
  const key = resolveExecutionCacheKey(keyInput)
  if (!key) throw new Error('Expected a cacheable key')
  return {
    schemaVersion: 1,
    key,
    requiredVariables: ['email'],
    adapterPayload: {
      operation: 'fill',
      argument: { variable: 'email' },
    },
  }
}

describe('Execution cache contract', () => {
  test('resolves the complete cache key only with an application revision', () => {
    expect(resolveExecutionCacheKey(keyInput)).toEqual(keyInput)
    expect(
      resolveExecutionCacheKey({
        ...keyInput,
        applicationRevision: undefined,
      }),
    ).toBeUndefined()
    expect(
      resolveExecutionCacheKey({
        ...keyInput,
        applicationRevision: '   ',
      }),
    ).toBeUndefined()
  })

  test('rejects parameter bindings from the cache key contract', () => {
    expect(() =>
      resolveExecutionCacheKey({
        ...keyInput,
        bindings: { email: 'customer@example.com' },
      } as typeof keyInput),
    ).toThrow('bindings is not supported in an Execution cache key')
  })

  test('round-trips a strictly validated, placeholder-only adapter payload', () => {
    const cacheEnvelope = envelope()
    const serialized = serializeExecutionCacheEnvelope(
      cacheEnvelope,
      payloadValidator,
    )

    expect(serialized.source).not.toContain('customer@example.com')
    expect(serialized.key).toEqual(cacheEnvelope.key)
    expect(
      deserializeExecutionCacheEnvelope({
        source: serialized.source,
        expectedKey: cacheEnvelope.key,
        payloadValidator,
      }),
    ).toEqual(cacheEnvelope)
  })

  test('rejects a bound parameter value before persistence', () => {
    const cacheEnvelope = envelope()

    expect(() =>
      serializeExecutionCacheEnvelope(
        {
          ...cacheEnvelope,
          adapterPayload: {
            operation: 'fill',
            argument: 'customer@example.com',
          },
        },
        payloadValidator,
      ),
    ).toThrow('adapter payload is not cacheable')
  })

  test('accepts variable names but rejects bound values in envelope metadata', () => {
    const cacheEnvelope = envelope()

    expect(() =>
      serializeExecutionCacheEnvelope(
        {
          ...cacheEnvelope,
          requiredVariables: ['customer@example.com'],
          adapterPayload: {
            operation: 'fill',
            argument: { variable: 'customer@example.com' },
          },
        },
        payloadValidator,
      ),
    ).toThrow('envelope is not cacheable')
  })

  test('treats incompatible envelopes and adapter payloads as safe misses', () => {
    const cacheEnvelope = envelope()
    const serialized = serializeExecutionCacheEnvelope(
      cacheEnvelope,
      payloadValidator,
    )
    const parsed = JSON.parse(serialized.source) as Record<string, unknown>

    expect(
      deserializeExecutionCacheEnvelope({
        source: JSON.stringify({ ...parsed, schemaVersion: 2 }),
        expectedKey: cacheEnvelope.key,
        payloadValidator,
      }),
    ).toBeUndefined()
    expect(
      deserializeExecutionCacheEnvelope({
        source: serialized.source,
        expectedKey: {
          ...cacheEnvelope.key,
          applicationRevision: 'another-application-revision',
        },
        payloadValidator,
      }),
    ).toBeUndefined()
    expect(
      deserializeExecutionCacheEnvelope({
        source: serialized.source,
        expectedKey: cacheEnvelope.key,
        payloadValidator: {
          ...payloadValidator,
          adapterCacheSchemaVersion: 'contract-test.2',
        },
      }),
    ).toBeUndefined()
    expect(
      deserializeExecutionCacheEnvelope({
        source: JSON.stringify({
          ...parsed,
          adapterPayload: {
            operation: 'fill',
            argument: 'customer@example.com',
          },
        }),
        expectedKey: cacheEnvelope.key,
        payloadValidator,
      }),
    ).toBeUndefined()
  })

  test('exposes a storage port over serialized, unbound envelopes', async () => {
    const entries = new Map<string, string>()
    const inspectedEntries: ExecutionCacheEntryMetadata[] = []
    const store: ExecutionCacheStore = {
      async read(key) {
        return entries.get(JSON.stringify(key))
      },
      async write(serialized, metadata) {
        entries.set(JSON.stringify(serialized.key), serialized.source)
        inspectedEntries.push({
          key: serialized.key,
          createdAt: '2026-08-21T12:00:00.000Z',
          lastUsedAt: '2026-08-21T12:00:00.000Z',
          hitCount: 0,
          payloadDigest: 'payload-digest',
          sizeBytes: Buffer.byteLength(serialized.source),
          ...metadata,
        })
        return { stored: true, evictedEntries: 0 }
      },
      async delete(key) {
        entries.delete(JSON.stringify(key))
      },
      async inspect() {
        return inspectedEntries
      },
      async clear() {
        entries.clear()
        inspectedEntries.length = 0
      },
    }
    const cacheEnvelope = envelope()
    const serializedEnvelope = serializeExecutionCacheEnvelope(
      cacheEnvelope,
      payloadValidator,
    )

    const writeResult = await store.write(serializedEnvelope, {
      sourceRunId: 'run-1',
      evaluationModel: 'model-1',
      evaluationInferenceCount: 2,
    })
    expect(writeResult).toEqual({ stored: true, evictedEntries: 0 })
    expect(await store.read(cacheEnvelope.key)).toBe(serializedEnvelope.source)
    expect(await store.inspect()).toEqual([
      expect.objectContaining({
        key: cacheEnvelope.key,
        sourceRunId: 'run-1',
        evaluationModel: 'model-1',
        evaluationInferenceCount: 2,
        hitCount: 0,
      }),
    ])
    await store.delete(cacheEnvelope.key)
    expect(await store.read(cacheEnvelope.key)).toBeUndefined()
    await store.clear()
    expect(await store.inspect()).toEqual([])
  })

  test('represents cache behavior independently from the functional result', () => {
    const cacheEvents: RunEventPayload[] = [
      { type: 'cache-hit', cacheKey: envelope().key, scope: eventScope },
      { type: 'cache-miss', cacheKey: envelope().key, scope: eventScope },
      { type: 'cache-refresh', cacheKey: envelope().key, scope: eventScope },
      { type: 'replay-diverged', cacheKey: envelope().key, scope: eventScope },
      {
        type: 'adaptive-fallback-started',
        cacheKey: envelope().key,
        scope: { ...eventScope, attempt: 2 },
      },
      { type: 'cache-written', cacheKey: envelope().key, scope: eventScope },
      {
        type: 'cache-uncacheable',
        reason: 'bound-parameter-value',
        scope: eventScope,
      },
      {
        type: 'inference-count-updated',
        inferenceCount: 2,
        scope: eventScope,
      },
    ]
    const resultMetadata: Pick<
      ScenarioAttempt,
      'state' | 'executionMode' | 'cacheOutcome' | 'inferenceCount'
    > = {
      state: 'passed',
      executionMode: 'adaptive',
      cacheOutcome: 'fallback',
      inferenceCount: 2,
    }

    expect(cacheEvents.map((event) => event.type)).toEqual([
      'cache-hit',
      'cache-miss',
      'cache-refresh',
      'replay-diverged',
      'adaptive-fallback-started',
      'cache-written',
      'cache-uncacheable',
      'inference-count-updated',
    ])
    expect(resultMetadata).toEqual({
      state: 'passed',
      executionMode: 'adaptive',
      cacheOutcome: 'fallback',
      inferenceCount: 2,
    })
  })

  test('projects normalized cache observations onto public run events', () => {
    const event = withSharedEvidenceObservations({
      schemaVersion: 2,
      sequence: 4,
      occurredAt: '2026-08-29T12:00:00.000Z',
      type: 'cache-hit',
      cacheKey: envelope().key,
      scope: eventScope,
    })

    expect(publicRunEvent(event).observations).toEqual([
      {
        version: 1,
        kind: 'cache',
        summary: 'Cache Hit',
        timing: {
          occurredAt: '2026-08-29T12:00:00.000Z',
          precision: 'exact',
        },
        versions: [
          {
            subject: 'contract',
            label: 'run-event-schema',
            value: '2',
          },
          {
            subject: 'scenario',
            label: 'revision',
            value: 'scenario-revision',
          },
          {
            subject: 'application',
            label: 'revision',
            value: 'application-revision',
          },
          {
            subject: 'adapter',
            label: 'cache-schema',
            value: 'contract-test.1',
          },
        ],
        execution: {
          cacheDecision: {
            type: 'cache-hit',
            cacheKey: envelope().key,
          },
        },
      },
    ])
  })
})
