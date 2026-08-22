import { expect, test } from 'bun:test'
import { parseTestRunManifest } from './test-run-schema'
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
  input.results[0]!.attempts[0]!.evidenceAvailability = []

  expect(() => parseTestRunManifest(input, incompatibleSchema)).toThrow(
    'Evidence availability must include "screenshot"',
  )
})

test('rejects duplicate evidence availability kinds', () => {
  const input = manifest()
  input.results[0]!.attempts[0]!.evidenceAvailability.push({
    kind: 'screenshot',
    state: 'not-requested',
  })

  expect(() => parseTestRunManifest(input, incompatibleSchema)).toThrow(
    'Evidence availability kind "screenshot" must be unique',
  )
})

test('requires available artifact evidence to match persisted artifacts', () => {
  const input = manifest()
  input.results[0]!.attempts[0]!.evidenceAvailability[0] = {
    kind: 'screenshot',
    state: 'available',
  }

  expect(() => parseTestRunManifest(input, incompatibleSchema)).toThrow(
    'Available evidence for "screenshot" requires persisted evidence',
  )
})
