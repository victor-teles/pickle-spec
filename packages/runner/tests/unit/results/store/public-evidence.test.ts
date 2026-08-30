import { join } from 'node:path'
import { expect, test } from 'vitest'
import { runScenario } from '../../../../index'
import { requiredValue } from '../../../../src/required-value'
import {
  openTestRunStore,
  passedResult,
  scenarioFinished,
  storageFor,
  tempRoot,
} from './fixtures'

test('persists public evidence without private replay data', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-public-evidence',
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })
  const run = await store.create()
  const result = passedResult()
  const attempt = requiredValue(result.attempts[0])
  await run.append(
    scenarioFinished({
      ...result,
      attempts: [
        {
          ...attempt,
          executionMode: 'replay',
          cacheOutcome: 'hit',
          inferenceCount: 0,
          steps: [
            {
              index: 0,
              startedAt: attempt.startedAt,
              finishedAt: attempt.finishedAt,
              durationMs: attempt.durationMs,
              step: { keyword: 'When', text: 'I submit', type: 'action' },
              state: 'passed',
              resolvedActions: [
                {
                  description: 'Submit the form',
                  replay: { raw: 'private-replay-payload' },
                },
              ],
            },
          ],
        },
      ],
    }),
  )

  const manifest = await run.materialize()
  expect(manifest.results[0]?.attempts[0]).toMatchObject({
    executionMode: 'replay',
    cacheOutcome: 'hit',
    inferenceCount: 0,
    steps: [{ resolvedActions: [{ description: 'Submit the form' }] }],
  })
  expect(
    await Bun.file(
      join(storageFor(root).runsDirectory, run.id, 'events.ndjson'),
    ).text(),
  ).not.toContain('private-replay-payload')
  expect(
    await Bun.file(
      join(storageFor(root).runsDirectory, run.id, 'manifest.json'),
    ).text(),
  ).not.toContain('private-replay-payload')
})

test('persists runner-emitted observations without replay payloads', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-shared-observations',
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })
  const persisted = await store.create()
  const run = await runScenario({
    specification: {
      name: 'Checkout',
      source: { uri: 'features/checkout.feature', language: 'en' },
      tags: [],
      scenarios: [],
    },
    scenario: {
      id: 'scenario-receipt',
      name: 'Capture the receipt',
      tags: [],
      steps: [
        {
          keyword: 'Then',
          text: 'the receipt appears',
          type: 'outcome',
        },
      ],
    },
    executionTargetProfile: {
      id: 'web',
      adapter: 'web',
      capabilities: ['screenshots'],
    },
    adapter: {
      async openSession() {
        return {
          async executeStep() {
            return {
              state: 'passed' as const,
              resolvedActions: [
                {
                  description: 'Assert receipt on chrome',
                  replay: { raw: 'private-replay-payload' },
                },
              ],
              artifacts: [
                {
                  kind: 'screenshot' as const,
                  path: '/tmp/receipt.png',
                  mediaType: 'image/png',
                },
              ],
            }
          },
          async complete() {
            return { inferenceCount: 1 }
          },
          async close() {},
        }
      },
    },
    now: (() => {
      const timestamps = [
        '2026-08-15T12:00:01.000Z',
        '2026-08-15T12:00:02.000Z',
        '2026-08-15T12:00:03.000Z',
        '2026-08-15T12:00:04.000Z',
      ]
      let index = 0
      return () => new Date(requiredValue(timestamps[index++]))
    })(),
  })

  for (const event of run.events) {
    await persisted.append(event)
  }

  const storedEvents = await persisted.events()
  const stepFinished = storedEvents.find(
    (event) => event.type === 'step-finished',
  )
  expect(stepFinished).toMatchObject({
    type: 'step-finished',
    observations: [
      {
        kind: 'outcome',
      },
      {
        kind: 'activity',
        activity: {
          kind: 'resolved-action',
          description: 'Assert receipt on chrome',
        },
      },
      {
        kind: 'artifact',
        artifact: {
          kind: 'screenshot',
          path: expect.any(String),
        },
      },
    ],
  })
  const eventsSource = await Bun.file(
    join(storageFor(root).runsDirectory, persisted.id, 'events.ndjson'),
  ).text()
  expect(eventsSource).not.toContain('private-replay-payload')
  expect(eventsSource).toContain('"observations"')
})
