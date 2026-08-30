import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ImportRunArchiveInput,
  importRunArchive as importRunArchiveBase,
  openTestRunStore as openTestRunStoreBase,
  resolveLocalProjectStorage,
  type TestRunStoreOptions,
  type WriteRunArchiveInput,
  writeRunArchive as writeRunArchiveBase,
} from '../../../../index'
import type { TestResult } from '../../../../src/execution/run-scenario'
import { requiredValue } from '../../../../src/required-value'

export async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pickle-archive-'))
}

export function pickleHomeFor(root: string): string {
  return join(root, '.pickle-home')
}

export function storageFor(root: string) {
  return resolveLocalProjectStorage(root, pickleHomeFor(root))
}

export function openTestRunStore(options: TestRunStoreOptions) {
  return openTestRunStoreBase({
    ...options,
    pickleHome: pickleHomeFor(options.root),
  })
}

export function writeRunArchive(input: WriteRunArchiveInput) {
  return writeRunArchiveBase({
    ...input,
    pickleHome: pickleHomeFor(input.root),
  })
}

export function importRunArchive(input: ImportRunArchiveInput) {
  return importRunArchiveBase({
    ...input,
    pickleHome: pickleHomeFor(input.root),
  })
}

export function unavailableEvidence(): TestResult['attempts'][number]['evidenceAvailability'] {
  return [
    { kind: 'screenshot', state: 'not-supported' },
    { kind: 'trace', state: 'not-supported' },
    { kind: 'recording', state: 'not-supported' },
    { kind: 'device-log', state: 'not-supported' },
    { kind: 'diagnostics', state: 'not-supported' },
  ]
}

export function passedResult(): TestResult {
  const startedAt = '2026-08-15T12:00:00.000Z'
  const finishedAt = '2026-08-15T12:00:00.012Z'
  return {
    schemaVersion: 2,
    specification: {
      name: 'Checkout',
      uri: 'features/checkout.feature',
    },
    scenario: { name: 'Complete a purchase', id: 'scnpurchasebbbbbb' },
    executionTargetProfile: { id: 'deterministic' },
    state: 'passed',
    startedAt,
    finishedAt,
    durationMs: 12,
    attempts: [
      {
        attempt: 1,
        startedAt,
        finishedAt,
        durationMs: 12,
        state: 'passed',
        steps: [],
        executionMode: 'replay',
        cacheOutcome: 'hit',
        inferenceCount: 0,
        evidenceAvailability: unavailableEvidence(),
      },
    ],
  }
}

export function scenarioFinished(result: TestResult, attemptIndex = -1) {
  const attempt = requiredValue(result.attempts.at(attemptIndex))
  return {
    type: 'scenario-finished' as const,
    specification: result.specification,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: {
      scenarioId: requiredValue(result.scenario.id),
      examplesRowId: result.scenario.examplesRowId,
      executionTargetProfileId: result.executionTargetProfile.id,
      attempt: attempt.attempt,
    },
    attempt,
  }
}

export function failedResultWithArtifact(path: string): TestResult {
  const result = passedResult()
  const attempt = requiredValue(result.attempts[0])
  const step = {
    index: 0,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    durationMs: attempt.durationMs,
    step: {
      keyword: 'Then',
      text: 'payment is captured',
      type: 'outcome' as const,
    },
    state: 'failed' as const,
    resolvedActions: [{ description: 'Click pay on chrome' }],
    message: 'Payment was declined',
    artifacts: [
      {
        kind: 'screenshot' as const,
        path,
        mediaType: 'image/png',
        name: 'failure.png',
        capturedAt: attempt.finishedAt,
        sizeBytes: 16,
      },
    ],
  }
  return {
    ...result,
    state: 'failed',
    attempts: [
      {
        ...attempt,
        state: 'failed',
        steps: [step],
        evidenceAvailability: unavailableEvidence().map((availability) =>
          availability.kind === 'screenshot'
            ? { ...availability, state: 'available' as const }
            : availability,
        ),
      },
    ],
  }
}

export function emptyArchive(id: string) {
  const startedAt = '2026-08-01T00:00:00.000Z'
  return {
    schemaVersion: 2 as const,
    kind: 'run-archive' as const,
    manifest: {
      schemaVersion: 2 as const,
      id,
      startedAt,
      finishedAt: '2026-08-01T00:00:01.000Z',
      state: 'passed' as const,
      results: [],
    },
    events: [
      {
        schemaVersion: 2 as const,
        sequence: 1,
        occurredAt: startedAt,
        type: 'run-started' as const,
        run: { id, startedAt },
      },
    ],
    artifacts: [],
  }
}

export function archiveWithResult(id: string, result: TestResult) {
  const archive = emptyArchive(id)
  return {
    ...archive,
    manifest: {
      ...archive.manifest,
      finishedAt: result.finishedAt,
      state: result.state,
      results: [result],
    },
    events: [
      ...archive.events,
      {
        ...scenarioFinished(result),
        schemaVersion: 2 as const,
        sequence: 2,
        occurredAt: result.finishedAt,
      },
    ],
  }
}
