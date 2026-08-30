import { join } from 'node:path'
import { expect, test } from 'vitest'
import { requiredValue } from '../../../../src/required-value'
import { withSharedEvidenceObservations } from '../../../../src/results/evidence-observations'
import {
  openTestRunStore,
  resultWithArtifact,
  scenarioFinished,
  storageFor,
  tempRoot,
} from './fixtures'

test('captures only failure artifacts under the default evidence policy', async () => {
  const root = await tempRoot()
  const screenshot = join(root, 'source-screenshot.png')
  await Bun.write(screenshot, new Uint8Array([137, 80, 78, 71]))
  const store = openTestRunStore({
    root,
    createId: () => 'run-artifacts',
  })
  const run = await store.create()

  await run.append(
    scenarioFinished(
      resultWithArtifact('Passed purchase', 'passed', screenshot),
    ),
  )
  const failedResult = resultWithArtifact(
    'Failed purchase',
    'failed',
    screenshot,
  )
  const failedAttempt = requiredValue(failedResult.attempts[0])
  await run.append(
    scenarioFinished({
      ...failedResult,
      attempts: [
        {
          ...failedAttempt,
          steps: [
            {
              ...requiredValue(failedAttempt.steps[0]),
              index: 0,
              step: {
                keyword: 'Given',
                text: 'a product is in the basket',
                type: 'context',
              },
              state: 'passed',
            },
            { ...requiredValue(failedAttempt.steps[0]), index: 1 },
          ],
        },
      ],
    }),
  )

  const manifest = await run.materialize()
  const passed = manifest.results.find(
    (result) => result.scenario.name === 'Passed purchase',
  )
  const failed = manifest.results.find(
    (result) => result.scenario.name === 'Failed purchase',
  )
  const artifactsDirectory = join(
    storageFor(root).runsDirectory,
    'run-artifacts',
    'artifacts',
  )

  expect(passed?.attempts[0]?.steps[0]?.artifacts).toBeUndefined()
  expect(
    failed?.attempts[0]?.steps[0]?.artifacts?.[0]?.path.startsWith(
      artifactsDirectory,
    ),
  ).toBe(true)
  expect(
    failed?.attempts[0]?.steps[1]?.artifacts?.[0]?.path.startsWith(
      artifactsDirectory,
    ),
  ).toBe(true)
  expect(
    await Bun.file(
      requiredValue(
        requiredValue(
          requiredValue(
            requiredValue(requiredValue(failed).attempts[0]).steps[1],
          ).artifacts,
        )[0],
      ).path,
    ).bytes(),
  ).toEqual(new Uint8Array([137, 80, 78, 71]))
  expect(await Bun.file(screenshot).exists()).toBe(true)
})

test('persists Diagnostic entries for failed runs by default and drops them for passed runs', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-diagnostics',
  })
  const run = await store.create()
  const diagnostic = {
    occurredAt: '2026-08-23T12:00:00.004Z',
    level: 'error' as const,
    origin: 'console' as const,
    message: 'Payment was declined',
    scenarioName: 'Complete a purchase',
    stepIndex: 0,
    stepText: 'Then the purchase succeeds',
    executionTargetProfileId: 'deterministic',
  }
  const trace = {
    occurredAt: '2026-08-23T12:00:00.004Z',
    kind: 'resolved-action' as const,
    description: 'Click pay on chrome',
  }
  const passed = resultWithArtifact(
    'Passed purchase',
    'passed',
    join(root, 'unused.png'),
  )
  const failed = resultWithArtifact(
    'Failed purchase',
    'failed',
    join(root, 'unused.png'),
  )
  const passedAttempt = requiredValue(passed.attempts[0])
  const failedAttempt = requiredValue(failed.attempts[0])
  const liveStep = {
    ...requiredValue(passedAttempt.steps[0]),
    artifacts: undefined,
    diagnostics: [diagnostic],
    trace: [trace],
  }
  const liveEvent = await run.append(
    withSharedEvidenceObservations({
      schemaVersion: 2,
      sequence: 2,
      occurredAt: liveStep.finishedAt,
      type: 'step-finished',
      result: liveStep,
      scenario: passed.scenario,
      executionTargetProfile: passed.executionTargetProfile,
      scope: {
        scenarioId: requiredValue(passed.scenario.id),
        executionTargetProfileId: passed.executionTargetProfile.id,
        attempt: passedAttempt.attempt,
        stepIndex: liveStep.index,
      },
    }),
  )

  expect(liveEvent).toMatchObject({
    type: 'step-finished',
    result: { diagnostics: [diagnostic], trace: [trace] },
    observations: expect.any(Array),
  })
  const persistedLiveStep = (await run.events()).at(-1)
  expect(persistedLiveStep?.type).toBe('step-finished')
  if (persistedLiveStep?.type !== 'step-finished') {
    throw new Error('Expected a persisted step-finished event')
  }
  expect(persistedLiveStep.result.diagnostics).toBeUndefined()
  expect(persistedLiveStep.result.trace).toBeUndefined()
  expect(persistedLiveStep.observations).toEqual([
    {
      version: 1,
      kind: 'outcome',
      summary: 'Then the purchase succeeds passed',
      timing: {
        occurredAt: passedAttempt.finishedAt,
        precision: 'step-finish',
        startedAt: passedAttempt.startedAt,
        finishedAt: passedAttempt.finishedAt,
        durationMs: passedAttempt.durationMs,
      },
      outcome: { state: 'passed' },
    },
    {
      version: 1,
      kind: 'activity',
      summary: 'Click pay on chrome',
      timing: {
        occurredAt: trace.occurredAt,
        precision: 'exact',
        startedAt: passedAttempt.startedAt,
        finishedAt: passedAttempt.finishedAt,
        durationMs: passedAttempt.durationMs,
      },
      activity: {
        kind: 'resolved-action',
        description: 'Click pay on chrome',
      },
    },
    {
      version: 1,
      kind: 'diagnostic',
      summary: diagnostic.message,
      timing: {
        occurredAt: diagnostic.occurredAt,
        precision: 'exact',
      },
      outcome: {
        level: diagnostic.level,
        message: diagnostic.message,
      },
    },
  ])

  await run.append(
    scenarioFinished({
      ...passed,
      attempts: [
        {
          ...passedAttempt,
          diagnostics: [diagnostic],
          evidenceAvailability: passedAttempt.evidenceAvailability.map(
            (item) => {
              if (item.kind === 'screenshot') {
                return { kind: item.kind, state: 'not-requested' as const }
              }
              return item.kind === 'diagnostics' || item.kind === 'trace'
                ? { kind: item.kind, state: 'available' as const }
                : item
            },
          ),
          steps: passedAttempt.steps.map((step) => ({
            ...step,
            artifacts: undefined,
            diagnostics: [diagnostic],
            trace: [trace],
          })),
        },
      ],
    }),
  )
  await run.append(
    scenarioFinished({
      ...failed,
      attempts: [
        {
          ...failedAttempt,
          diagnostics: [diagnostic],
          evidenceAvailability: failedAttempt.evidenceAvailability.map(
            (item) => {
              if (item.kind === 'screenshot') {
                return { kind: item.kind, state: 'not-requested' as const }
              }
              return item.kind === 'diagnostics' || item.kind === 'trace'
                ? { kind: item.kind, state: 'available' as const }
                : item
            },
          ),
          steps: failedAttempt.steps.map((step) => ({
            ...step,
            artifacts: undefined,
            diagnostics: [diagnostic],
            trace: [trace],
          })),
        },
      ],
    }),
  )

  const manifest = await run.materialize()
  const passedPersisted = manifest.results.find(
    (result) => result.scenario.name === 'Passed purchase',
  )
  const failedPersisted = manifest.results.find(
    (result) => result.scenario.name === 'Failed purchase',
  )

  expect(passedPersisted?.attempts[0]?.steps[0]?.diagnostics).toBeUndefined()
  expect(passedPersisted?.attempts[0]?.diagnostics).toBeUndefined()
  expect(passedPersisted?.attempts[0]?.steps[0]?.trace).toBeUndefined()
  expect(
    passedPersisted?.attempts[0]?.evidenceAvailability.find(
      (item) => item.kind === 'diagnostics',
    )?.state,
  ).toBe('not-retained')
  expect(
    passedPersisted?.attempts[0]?.evidenceAvailability.find(
      (item) => item.kind === 'trace',
    )?.state,
  ).toBe('not-retained')
  expect(failedPersisted?.attempts[0]?.steps[0]?.diagnostics).toEqual([
    diagnostic,
  ])
  expect(failedPersisted?.attempts[0]?.diagnostics).toEqual([diagnostic])
  expect(failedPersisted?.attempts[0]?.steps[0]?.trace).toEqual([trace])
})
