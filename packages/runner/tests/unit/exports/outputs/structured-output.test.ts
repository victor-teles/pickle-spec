import { expect, test } from 'vitest'
import {
  formatJson,
  formatNdjson,
  publicRunEvent,
  publicTestResult,
} from '../../../../index'
import type { RunEvent } from '../../../../src/execution/run-scenario'
import type { TestRunManifest } from '../../../../src/results/test-run-store'
import {
  canonicalEvents,
  canonicalManifest,
  events,
  manifest,
  result,
  scenarioFinishedEvent,
  step,
} from './fixtures'

test('formats versioned JSON from the materialized test-run schema', () => {
  expect(JSON.parse(formatJson(manifest))).toEqual(manifest)
  expect(manifest.results[1]?.state).toBe('passed')
})

test('formats NDJSON from the versioned run-event schema', () => {
  expect(
    formatNdjson(events)
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  ).toEqual(events)
})

test('projects canonical schema-v2 Test evidence to exact JSON', () => {
  expect(
    JSON.parse(formatJson(canonicalManifest as unknown as TestRunManifest)),
  ).toEqual(canonicalManifest)
})

test('projects canonical schema-v2 Run events to exact NDJSON', () => {
  expect(
    formatNdjson(canonicalEvents as unknown as RunEvent[])
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  ).toEqual([...canonicalEvents])
})

test('preserves Execution cache behavior in JSON and NDJSON', () => {
  const cached = result('Replay checkout', 'passed', {
    attempt: {
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
    },
  })
  const uncacheable = result('Adaptive checkout', 'passed', {
    attempt: {
      executionMode: 'adaptive',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'non-deterministic-assertion',
      inferenceCount: 2,
    },
  })
  const structuredManifest = { ...manifest, results: [cached, uncacheable] }

  expect(JSON.parse(formatJson(structuredManifest)).results).toEqual([
    cached,
    uncacheable,
  ])
  expect(formatNdjson([scenarioFinishedEvent(cached)])).toContain(
    '"executionMode":"replay"',
  )
})

test('public output boundaries omit private replay data without mutating results', () => {
  const privateStep = step(0, 'passed', {
    step: { keyword: 'When', text: 'I submit', type: 'action' },
    resolvedActions: [
      {
        description: 'Submit the form',
        replay: { raw: 'private-replay-payload' },
      },
    ],
  })
  const privateResult = result('Private cache payload', 'passed', {
    attempt: {
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
      steps: [privateStep],
    },
  })
  const privateEvent = scenarioFinishedEvent(privateResult)

  expect(formatJson({ ...manifest, results: [privateResult] })).not.toContain(
    'private-replay-payload',
  )
  expect(formatNdjson([privateEvent])).not.toContain('private-replay-payload')
  expect(
    publicTestResult(privateResult).attempts[0]?.steps[0]?.resolvedActions,
  ).toEqual([{ description: 'Submit the form' }])
  expect(privateStep.resolvedActions[0]?.replay).toEqual({
    raw: 'private-replay-payload',
  })
})

test('public event boundaries whitelist non-result event fields', () => {
  const malicious = {
    schemaVersion: 2,
    sequence: 1,
    occurredAt: '2026-08-15T12:00:00.000Z',
    type: 'run-started',
    prompt: 'private-system-prompt',
    adapterPayload: { secret: 'private-adapter-payload' },
    run: {
      id: 'run-public',
      startedAt: '2026-08-15T12:00:00.000Z',
      privateValue: 'private-bound-value',
    },
  } as unknown as RunEvent

  const source = JSON.stringify(publicRunEvent(malicious))
  expect(source).toBe(
    '{"type":"run-started","run":{"id":"run-public","startedAt":"2026-08-15T12:00:00.000Z"},"schemaVersion":2,"sequence":1,"occurredAt":"2026-08-15T12:00:00.000Z"}',
  )
})
