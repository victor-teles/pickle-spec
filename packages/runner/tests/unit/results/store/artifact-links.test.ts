import { join } from 'node:path'
import { expect, test } from 'vitest'
import { requiredValue } from '../../../../src/required-value'
import {
  actionFinished,
  openTestRunStore,
  resultWithArtifact,
  scenarioFinished,
  tempRoot,
} from './fixtures'

test('links persisted artifacts to canonical non-adjacent event ranges', async () => {
  const root = await tempRoot()
  const screenshot = join(root, 'terminal.png')
  const recording = join(root, 'scenario.mp4')
  await Bun.write(screenshot, 'image')
  await Bun.write(recording, 'video')
  const run = await openTestRunStore({
    root,
    createId: () => 'run-artifact-links',
  }).create()
  const result = resultWithArtifact('Linked evidence', 'failed', screenshot)
  const attempt = requiredValue(result.attempts[0])
  const terminal = {
    ...requiredValue(attempt.steps[0]),
    index: 1,
    artifacts: [
      { kind: 'screenshot' as const, path: screenshot },
      { kind: 'recording' as const, path: recording },
    ],
  }
  const scope = {
    scenarioId: requiredValue(result.scenario.id),
    executionTargetProfileId: result.executionTargetProfile.id,
    attempt: attempt.attempt,
  }
  const stepStarted = (stepIndex: number) => ({
    type: 'step-started' as const,
    step: terminal.step,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: { ...scope, stepIndex },
  })

  await run.append(stepStarted(0))
  await run.append({
    type: 'step-finished',
    result: { ...terminal, index: 0, artifacts: undefined },
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: { ...scope, stepIndex: 0 },
  })
  await run.append(stepStarted(1))
  await run.append({
    type: 'cache-uncacheable',
    reason: 'non-deterministic-action',
    scope: { ...scope, stepIndex: 1 },
  })
  const finished = await run.append({
    type: 'step-finished',
    result: terminal,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: { ...scope, stepIndex: 1 },
  })

  expect(finished).toMatchObject({
    sequence: 6,
    result: {
      artifacts: [
        {
          kind: 'screenshot',
          evidenceLink: {
            stepIndex: 1,
            eventRange: { startSequence: 4, endSequence: 6 },
          },
        },
        {
          kind: 'recording',
          evidenceLink: {
            stepIndex: 1,
            eventRange: { startSequence: 2, endSequence: 6 },
          },
        },
      ],
    },
  })
  await run.append(
    scenarioFinished({
      ...result,
      attempts: [
        {
          ...attempt,
          steps: [{ ...terminal, index: 0, artifacts: undefined }, terminal],
          evidenceAvailability: attempt.evidenceAvailability.map(
            (availability) =>
              availability.kind === 'recording'
                ? { ...availability, state: 'available' as const }
                : availability,
          ),
        },
      ],
    }),
  )
  const scenarioFinish = (await run.events()).at(-1)
  expect(scenarioFinish).toMatchObject({
    type: 'scenario-finished',
    sequence: 7,
    attempt: {
      steps: [
        {},
        {
          artifacts: [
            {
              evidenceLink: {
                eventRange: { startSequence: 4, endSequence: 6 },
              },
            },
            {
              evidenceLink: {
                eventRange: { startSequence: 2, endSequence: 6 },
              },
            },
          ],
        },
      ],
    },
  })
})

test.each(['off', 'on-failure'] as const)(
  'persists stripped provisional action evidence under %s while returning the full live record',
  async (evidencePersistence) => {
    const root = await tempRoot()
    const screenshotPath = join(root, `${evidencePersistence}-action.png`)
    await Bun.write(screenshotPath, new Uint8Array([137, 80, 78, 71]))
    const run = await openTestRunStore({
      root,
      createId: () => `run-action-${evidencePersistence}`,
      evidencePersistence,
    }).create()

    const live = await run.append(actionFinished(screenshotPath))

    expect(live).toMatchObject({
      type: 'action-finished',
      action: {
        screenshots: { before: { state: 'available' } },
        diagnostics: [{ message: 'provisional diagnostic' }],
      },
    })
    const persisted = requiredValue(
      (await run.events()).find((event) => event.type === 'action-finished'),
    )
    expect(persisted).toMatchObject({
      type: 'action-finished',
      action: {
        screenshots: { before: { state: 'not-retained' } },
        diagnostics: [],
      },
    })
    expect(JSON.stringify(persisted)).not.toContain(screenshotPath)
    expect(JSON.stringify(persisted)).not.toContain('provisional diagnostic')
  },
)

test('reuses always-retained action screenshots through scenario completion', async () => {
  const root = await tempRoot()
  const screenshotPath = join(root, 'always-action.png')
  await Bun.write(screenshotPath, new Uint8Array([137, 80, 78, 71]))
  const run = await openTestRunStore({
    root,
    createId: () => 'run-action-always',
    evidencePersistence: 'always',
  }).create()

  const published = await run.append(actionFinished(screenshotPath))

  expect(published.type).toBe('action-finished')
  if (published.type !== 'action-finished') {
    throw new Error('Expected published Action evidence')
  }
  const before = published.action.screenshots.before
  expect(before.state).toBe('available')
  if (before.state !== 'available') {
    throw new Error('Expected persisted before screenshot')
  }
  expect(before.artifact.path).not.toBe(screenshotPath)
  expect(before.artifact.path).toContain('/artifacts/')
  expect(await Bun.file(before.artifact.path).exists()).toBe(true)
  const originalAction = actionFinished(screenshotPath).action
  const stepResult = {
    index: 0,
    startedAt: published.action.startedAt,
    finishedAt: published.action.finishedAt,
    durationMs: published.action.durationMs,
    step: { keyword: 'When', text: 'I pay', type: 'action' as const },
    state: 'passed' as const,
    resolvedActions: [
      { description: published.action.description, evidence: originalAction },
    ],
  }
  const step = await run.append({
    type: 'step-finished',
    result: stepResult,
    scenario: published.scenario,
    executionTargetProfile: published.executionTargetProfile,
    scope: published.scope,
  })
  expect(step).toMatchObject({
    type: 'step-finished',
    result: {
      resolvedActions: [
        {
          evidence: {
            screenshots: {
              before: { artifact: { path: before.artifact.path } },
            },
          },
        },
      ],
    },
  })
  const finished = await run.append({
    type: 'scenario-finished',
    specification: { name: 'Checkout', uri: 'features/checkout.feature' },
    scenario: published.scenario,
    executionTargetProfile: published.executionTargetProfile,
    scope: {
      scenarioId: published.scope.scenarioId,
      executionTargetProfileId: published.scope.executionTargetProfileId,
      attempt: published.scope.attempt,
    },
    attempt: {
      attempt: 1,
      startedAt: published.action.startedAt,
      finishedAt: published.action.finishedAt,
      durationMs: published.action.durationMs,
      state: 'passed',
      steps: [stepResult],
      evidenceAvailability: [
        { kind: 'screenshot', state: 'not-requested' },
        { kind: 'trace', state: 'not-requested' },
        { kind: 'recording', state: 'not-requested' },
        { kind: 'device-log', state: 'not-requested' },
        { kind: 'diagnostics', state: 'not-requested' },
      ],
    },
  })
  expect(finished).toMatchObject({
    type: 'scenario-finished',
    attempt: {
      steps: [
        {
          resolvedActions: [
            {
              evidence: {
                screenshots: {
                  before: { artifact: { path: before.artifact.path } },
                },
              },
            },
          ],
        },
      ],
    },
  })
  expect(
    (await run.events()).find((event) => event.type === 'action-finished'),
  ).toEqual(published)
})
