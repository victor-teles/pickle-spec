import { expect, test } from 'vitest'
import { requiredValue } from '../required-value'
import { parseRunEvent, parseTestRunManifest } from './test-run-schema'
import type { TestRunManifest } from './test-run-store'

const unavailableEvidence = [
  { kind: 'screenshot', state: 'not-requested' },
  { kind: 'trace', state: 'not-supported' },
  { kind: 'recording', state: 'not-supported' },
  { kind: 'device-log', state: 'not-supported' },
  { kind: 'diagnostics', state: 'not-supported' },
] as const

function manifest(): TestRunManifest {
  const occurredAt = '2026-08-22T12:00:00.000Z'
  return {
    schemaVersion: 2,
    id: 'run-evidence-contract',
    startedAt: occurredAt,
    finishedAt: occurredAt,
    state: 'passed',
    results: [
      {
        schemaVersion: 2,
        specification: { name: 'Evidence', uri: 'evidence.feature' },
        scenario: { id: 'scenario-evidence', name: 'Capture evidence' },
        executionTargetProfile: { id: 'web', capabilities: ['screenshots'] },
        state: 'passed',
        startedAt: occurredAt,
        finishedAt: occurredAt,
        durationMs: 0,
        attempts: [
          {
            attempt: 1,
            startedAt: occurredAt,
            finishedAt: occurredAt,
            durationMs: 0,
            state: 'passed',
            steps: [],
            evidenceAvailability: [...unavailableEvidence],
          },
        ],
      },
    ],
  }
}

const incompatibleSchema = (version: unknown): never => {
  throw new Error(`unsupported schema ${String(version)}`)
}

test('requires one availability entry for every evidence kind', () => {
  const input = manifest()
  requiredValue(
    requiredValue(input.results[0]).attempts[0],
  ).evidenceAvailability = []

  expect(() => parseTestRunManifest(input, incompatibleSchema)).toThrow(
    'Evidence availability must include "screenshot"',
  )
})

test('rejects duplicate evidence availability kinds', () => {
  const input = manifest()
  requiredValue(
    requiredValue(input.results[0]).attempts[0],
  ).evidenceAvailability.push({
    kind: 'screenshot',
    state: 'not-requested',
  })

  expect(() => parseTestRunManifest(input, incompatibleSchema)).toThrow(
    'Evidence availability kind "screenshot" must be unique',
  )
})

test('requires available artifact evidence to match persisted artifacts', () => {
  const input = manifest()
  requiredValue(
    requiredValue(input.results[0]).attempts[0],
  ).evidenceAvailability[0] = {
    kind: 'screenshot',
    state: 'available',
  }

  expect(() => parseTestRunManifest(input, incompatibleSchema)).toThrow(
    'Available evidence for "screenshot" requires persisted evidence',
  )
})

test('treats Diagnostic entries as persisted diagnostics evidence', () => {
  const input = manifest()
  const attempt = requiredValue(requiredValue(input.results[0]).attempts[0])
  const occurredAt = attempt.startedAt
  attempt.evidenceAvailability[4] = { kind: 'diagnostics', state: 'available' }
  attempt.diagnostics = [
    {
      occurredAt,
      causalAt: occurredAt,
      level: 'error',
      origin: 'console',
      message: 'Payment was declined',
      scenarioName: 'Capture evidence',
      stepIndex: 0,
      stepText: 'Then the purchase succeeds',
      executionTargetProfileId: 'web',
    },
  ]

  expect(() => parseTestRunManifest(input, incompatibleSchema)).not.toThrow()
})

test('retains the managed application stream on Diagnostic entries', () => {
  const input = manifest()
  const attempt = requiredValue(requiredValue(input.results[0]).attempts[0])
  attempt.evidenceAvailability[4] = { kind: 'diagnostics', state: 'available' }
  attempt.diagnostics = [
    {
      occurredAt: attempt.startedAt,
      level: 'info',
      origin: 'application',
      stream: 'stderr',
      message: 'Database connection retried',
      executionTargetProfileId: 'web',
    },
  ]

  expect(
    parseTestRunManifest(input, incompatibleSchema).results[0]?.attempts[0]
      ?.diagnostics?.[0],
  ).toMatchObject({ origin: 'application', stream: 'stderr' })
})

test('treats Pickle-native trace entries as persisted trace evidence', () => {
  const input = manifest()
  const attempt = requiredValue(requiredValue(input.results[0]).attempts[0])
  const occurredAt = attempt.startedAt
  attempt.evidenceAvailability[1] = { kind: 'trace', state: 'available' }
  attempt.steps = [
    {
      index: 0,
      startedAt: occurredAt,
      finishedAt: occurredAt,
      durationMs: 0,
      step: {
        keyword: 'Then',
        text: 'the purchase succeeds',
        type: 'outcome',
      },
      state: 'failed',
      resolvedActions: [{ description: 'Click pay on chrome' }],
      trace: [
        {
          occurredAt,
          causalAt: occurredAt,
          kind: 'resolved-action',
          description: 'Click pay on chrome',
        },
      ],
    },
  ]

  expect(() => parseTestRunManifest(input, incompatibleSchema)).not.toThrow()
})

test('retains adapter-neutral Test artifact capture metadata', () => {
  const input = manifest()
  const attempt = requiredValue(requiredValue(input.results[0]).attempts[0])
  attempt.evidenceAvailability[0] = {
    kind: 'screenshot',
    state: 'available',
  }
  attempt.steps = [
    {
      index: 0,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
      durationMs: 0,
      step: { keyword: 'Then', text: 'receipt appears', type: 'outcome' },
      state: 'passed',
      resolvedActions: [],
      artifacts: [
        {
          kind: 'screenshot',
          path: '/tmp/receipt.png',
          mediaType: 'image/png',
          name: 'receipt.png',
          capturedAt: attempt.finishedAt,
          sizeBytes: 4_096,
        },
      ],
    },
  ]

  const parsed = parseTestRunManifest(input, incompatibleSchema)

  expect(
    parsed.results[0]?.attempts[0]?.steps[0]?.artifacts?.[0],
  ).toMatchObject({
    name: 'receipt.png',
    capturedAt: attempt.finishedAt,
    sizeBytes: 4_096,
  })
})

test('parses run events with shared evidence observations', () => {
  const occurredAt = '2026-08-22T12:00:00.000Z'
  const parsed = parseRunEvent(
    {
      schemaVersion: 2,
      sequence: 1,
      occurredAt,
      type: 'cache-hit',
      cacheKey: {
        projectKey: 'project-1',
        scenarioId: 'scenario-evidence',
        scenarioRevision: 'revision-1',
        executionTargetProfileId: 'web',
        targetConfigurationFingerprint: 'target-config-1',
        applicationRevision: 'app-1',
        adapterKind: 'web',
        adapterCacheSchemaVersion: '1',
      },
      scope: {
        scenarioId: 'scenario-evidence',
        executionTargetProfileId: 'web',
        attempt: 1,
      },
      observations: [
        {
          version: 1,
          kind: 'cache',
          summary: 'Cache Hit',
          timing: {
            occurredAt,
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
              value: 'revision-1',
            },
          ],
          execution: {
            cacheDecision: {
              type: 'cache-hit',
            },
          },
        },
      ],
    },
    incompatibleSchema,
  )

  expect(parsed).toMatchObject({
    type: 'cache-hit',
    observations: [
      {
        kind: 'cache',
        execution: {
          cacheDecision: {
            type: 'cache-hit',
          },
        },
      },
    ],
  })
})
