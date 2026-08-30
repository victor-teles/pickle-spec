import { expect, test } from 'vitest'
import {
  openTestRunStore,
  passedResult,
  scenarioFinished,
  tempRoot,
  withAttempt,
} from './fixtures'

test('persists every final state and records flaky without adding a new state', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-states',
  })
  const run = await store.create()
  const states = [
    passedResult('Passed purchase'),
    withAttempt(passedResult('Failed purchase'), {
      state: 'failed',
      message: 'Payment was declined',
    }),
    withAttempt(passedResult('Skipped purchase'), {
      state: 'skipped',
      message: 'Scenario is tagged @ignore',
    }),
    withAttempt(passedResult('Cancelled purchase'), {
      state: 'cancelled',
      message: 'Scenario cancelled',
    }),
    withAttempt(passedResult('Unavailable purchase'), {
      state: 'infrastructure-error',
      message: 'Browser process exited',
    }),
  ]
  for (const result of states) {
    await run.append(scenarioFinished(result))
  }
  const flaky = passedResult('Flaky purchase')
  await run.append(
    scenarioFinished(
      withAttempt(flaky, { attempt: 1, state: 'infrastructure-error' }),
    ),
  )
  await run.append(
    scenarioFinished(withAttempt(flaky, { attempt: 2, state: 'passed' })),
  )

  const manifest = await run.materialize()
  expect(
    Object.fromEntries(
      manifest.results.map((result) => [
        result.scenario.name,
        { state: result.state, flaky: result.flaky },
      ]),
    ),
  ).toEqual({
    'Passed purchase': { state: 'passed', flaky: undefined },
    'Failed purchase': { state: 'failed', flaky: undefined },
    'Skipped purchase': { state: 'skipped', flaky: undefined },
    'Cancelled purchase': { state: 'cancelled', flaky: undefined },
    'Unavailable purchase': {
      state: 'infrastructure-error',
      flaky: undefined,
    },
    'Flaky purchase': { state: 'passed', flaky: true },
  })
  expect(manifest.state).toBe('infrastructure-error')
  expect(new Set(manifest.results.map((result) => result.state))).toEqual(
    new Set([
      'passed',
      'failed',
      'skipped',
      'cancelled',
      'infrastructure-error',
    ]),
  )
})
