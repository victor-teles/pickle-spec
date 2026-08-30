import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import {
  openTestRunStore as openTestRunStoreBase,
  resolveLocalProjectStorage,
  type TestRunStoreOptions,
} from '../../../../index'
import type {
  ActionEvidence,
  TestResult,
} from '../../../../src/execution/run-scenario'
import { requiredValue } from '../../../../src/required-value'

export const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

export async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pickle-test-runs-'))
  directories.push(root)
  return root
}

export function storageFor(root: string) {
  return resolveLocalProjectStorage(root, join(root, '.pickle-home'))
}

export function openTestRunStore(options: TestRunStoreOptions) {
  return openTestRunStoreBase({
    ...options,
    pickleHome: storageFor(options.root).pickleHome,
  })
}

export function passedResult(name = 'Complete a purchase'): TestResult {
  const startedAt = '2026-08-15T12:00:00.000Z'
  const finishedAt = '2026-08-15T12:00:00.012Z'
  return {
    schemaVersion: 2,
    specification: {
      name: 'Checkout',
      uri: 'features/checkout.feature',
    },
    scenario: {
      name,
      id: `scenario-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    },
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
        executionMode: 'adaptive',
        cacheOutcome: 'uncacheable',
        inferenceCount: 0,
        evidenceAvailability: [
          { kind: 'screenshot', state: 'not-supported' },
          { kind: 'trace', state: 'not-supported' },
          { kind: 'recording', state: 'not-supported' },
          { kind: 'device-log', state: 'not-supported' },
          { kind: 'diagnostics', state: 'not-supported' },
        ],
      },
    ],
  }
}

export const diagnosticEventScope = {
  scenarioId: 'diagnostic-scenario',
  executionTargetProfileId: 'deterministic',
  attempt: 1,
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

export function scenarioStarted(result: TestResult) {
  const attempt = requiredValue(result.attempts[0])
  return {
    type: 'scenario-started' as const,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: {
      scenarioId: requiredValue(result.scenario.id),
      examplesRowId: result.scenario.examplesRowId,
      executionTargetProfileId: result.executionTargetProfile.id,
      attempt: attempt.attempt,
    },
  }
}

export function actionFinished(
  screenshotPath: string,
  profileId = 'deterministic',
) {
  const occurredAt = '2026-08-15T12:00:00.006Z'
  const action: ActionEvidence = {
    version: 1,
    id: 'step-1-action-1',
    ordinal: 1,
    description: 'Click Pay',
    startedAt: '2026-08-15T12:00:00.004Z',
    finishedAt: occurredAt,
    durationMs: 2,
    state: 'passed',
    source: {
      uri: 'features/checkout.feature',
      language: 'en',
      line: 7,
      column: 5,
      excerpt: 'When I pay',
    },
    target: {
      before: { format: 'summary', summary: 'Ready state: complete' },
      after: { format: 'summary', summary: 'Ready state: complete' },
    },
    screenshots: {
      before: {
        state: 'available',
        artifact: { kind: 'screenshot', path: screenshotPath },
      },
      after: { state: 'not-requested' },
    },
    diagnostics: [
      {
        occurredAt,
        level: 'warning',
        origin: 'console',
        message: 'provisional diagnostic',
        executionTargetProfileId: profileId,
      },
    ],
    activity: [],
  }
  return {
    type: 'action-finished' as const,
    action,
    scenario: { id: 'scenario-checkout', name: 'Checkout' },
    executionTargetProfile: { id: profileId },
    scope: {
      scenarioId: 'scenario-checkout',
      executionTargetProfileId: profileId,
      attempt: 1,
      stepIndex: 0,
    },
  }
}

export function withAttempt(
  result: TestResult,
  patch: Partial<TestResult['attempts'][number]>,
): TestResult {
  const attempt = { ...requiredValue(result.attempts[0]), ...patch }
  return {
    ...result,
    state: attempt.state,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    durationMs: attempt.durationMs,
    attempts: [attempt],
  }
}

export function resultWithArtifact(
  name: string,
  state: TestResult['state'],
  path: string,
): TestResult {
  const result = passedResult(name)
  const attempt = requiredValue(result.attempts[0])
  return {
    ...result,
    state,
    attempts: [
      {
        ...attempt,
        state,
        evidenceAvailability: [
          { kind: 'screenshot', state: 'available' },
          { kind: 'trace', state: 'not-supported' },
          { kind: 'recording', state: 'not-supported' },
          { kind: 'device-log', state: 'not-supported' },
          { kind: 'diagnostics', state: 'not-supported' },
        ],
        steps: [
          {
            index: 0,
            startedAt: attempt.startedAt,
            finishedAt: attempt.finishedAt,
            durationMs: attempt.durationMs,
            step: {
              keyword: 'Then',
              text: 'the purchase succeeds',
              type: 'outcome',
            },
            state,
            resolvedActions: [],
            artifacts: [{ kind: 'screenshot', path, mediaType: 'image/png' }],
          },
        ],
      },
    ],
  }
}

export function withDiagnosticEvidence(result: TestResult): TestResult {
  const attempt = requiredValue(result.attempts[0])
  const diagnostic = {
    occurredAt: attempt.finishedAt,
    level: 'error' as const,
    origin: 'adapter' as const,
    message: `Diagnostic for ${result.scenario.name}`,
  }
  return {
    ...result,
    attempts: [
      {
        ...attempt,
        diagnostics: [diagnostic],
        evidenceAvailability: attempt.evidenceAvailability.map((item) =>
          item.kind === 'diagnostics'
            ? { kind: item.kind, state: 'available' as const }
            : item,
        ),
        steps: attempt.steps.map((step) => ({
          ...step,
          diagnostics: [diagnostic],
        })),
      },
    ],
  }
}
