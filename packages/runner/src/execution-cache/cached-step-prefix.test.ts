import { describe, expect, test } from 'bun:test'
import {
  attemptCacheUse,
  cachedStepPrefixFrom,
  evaluationAt,
  gapCursor,
  reseatGap,
  sealCachedStepPrefix,
} from './cached-step-prefix'
import type { ExecutionCachePayloadValidator } from './execution-cache'

const adapter: ExecutionCachePayloadValidator<{ steps: string[] }> = {
  adapterKind: 'test',
  adapterCacheSchemaVersion: '1',
  parse(payload) {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('steps' in payload) ||
      !Array.isArray(payload.steps)
    ) {
      return
    }
    return { steps: payload.steps as string[] }
  },
  prefixStepCount(payload) {
    return payload.steps.length
  },
}

describe('CachedStepPrefix', () => {
  test('mints a dense head and rejects an empty payload', () => {
    const prefix = cachedStepPrefixFrom(
      {
        adapterPayload: { steps: ['confirm'] },
        requiredVariables: [],
      },
      2,
      adapter,
    )
    expect(prefix?.stepCount).toBe(1)
    expect(
      cachedStepPrefixFrom(
        { adapterPayload: { steps: [] }, requiredVariables: [] },
        2,
        adapter,
      ),
    ).toBeUndefined()
  })

  test('seals a cacheable representation and ignores cacheable false', () => {
    expect(
      sealCachedStepPrefix({
        compiledPayload: {
          cacheable: true,
          adapterPayload: { steps: ['confirm'] },
          requiredVariables: [],
        },
        scenarioStepCount: 2,
        adapter,
      })?.stepCount,
    ).toBe(1)
    expect(
      sealCachedStepPrefix({
        compiledPayload: {
          cacheable: false,
          reason: 'non-deterministic-action',
        },
        scenarioStepCount: 2,
        adapter,
      }),
    ).toBeUndefined()
  })

  test('gap cursor treats replayUntil as exclusive', () => {
    const prefix = cachedStepPrefixFrom(
      {
        adapterPayload: { steps: ['confirm'] },
        requiredVariables: [],
      },
      2,
      adapter,
    )
    const cursor = gapCursor(prefix)
    expect(evaluationAt(cursor, 0)).toBe('replay')
    expect(evaluationAt(cursor, 1)).toBe('adaptive')
    expect(evaluationAt(gapCursor(undefined), 0)).toBe('adaptive')
    expect(reseatGap(cursor, 0)).toEqual({ replayUntil: 0 })
  })

  test('attemptCacheUse makes hit-with-inference unrepresentable', () => {
    expect(
      attemptCacheUse({
        prefixStepCount: 2,
        scenarioStepCount: 2,
        inferenceCount: 0,
        startedFrom: 'entry',
      }),
    ).toEqual({ cacheOutcome: 'hit', inferenceCount: 0 })
    expect(
      attemptCacheUse({
        prefixStepCount: 1,
        scenarioStepCount: 2,
        inferenceCount: 3,
        startedFrom: 'entry',
      }),
    ).toEqual({
      cacheOutcome: 'partial-hit',
      prefixStepCount: 1,
      inferenceCount: 3,
    })
    expect(() =>
      attemptCacheUse({
        prefixStepCount: 2,
        scenarioStepCount: 2,
        inferenceCount: 1,
        startedFrom: 'entry',
      }),
    ).toThrow(
      'Replay must complete the Scenario with zero evaluation inference',
    )
  })
})
