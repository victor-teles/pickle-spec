import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { StudioProject } from '../../server/contracts'
import { FirstRunOnboarding } from './first-run-onboarding'

const project: StudioProject = {
  name: 'shop',
  root: '/shop',
  profiles: ['chrome'],
  suites: [],
  specifications: [
    {
      id: 'checkout',
      name: 'Checkout',
      uri: 'features/checkout.feature',
      scenarios: [
        {
          id: 'pay',
          name: 'Pay',
          readiness: {
            ready: false,
            reasons: [
              'Execution target profile "chrome" lacks geolocation',
              'Local browser is missing. Install Chrome or configure Browserbase.',
            ],
            checks: [
              { id: 'selection', status: 'ready' },
              {
                id: 'execution-target',
                status: 'blocked',
                reasons: [
                  'Execution target profile "chrome" lacks geolocation',
                ],
              },
              { id: 'model-credential', status: 'not-applicable' },
              {
                id: 'environment',
                status: 'blocked',
                reasons: [
                  'Local browser is missing. Install Chrome or configure Browserbase.',
                ],
              },
            ],
          },
        },
      ],
    },
  ],
}

test('renders an accessible checklist with structured setup blockers', () => {
  const markup = renderToStaticMarkup(
    <FirstRunOnboarding
      project={project}
      running={false}
      onOpenSettings={() => {}}
      onRun={async () => {}}
    />,
  )

  expect(markup).toContain('aria-labelledby="first-run-title"')
  expect(markup).toContain('aria-label="First-run readiness"')
  expect(markup).toContain('Execution target ready')
  expect(markup).toContain('lacks geolocation')
  expect(markup).toContain('Local environment ready')
  expect(markup).toContain('Install Chrome or configure Browserbase')
  expect(markup).toContain('Open Settings')
  expect(markup).toContain('Persist one passed Test run')
})

test('renders nothing after a persisted passed run', () => {
  const markup = renderToStaticMarkup(
    <FirstRunOnboarding
      project={project}
      running={false}
      runsIndex={{
        runs: [
          {
            id: 'run-passed',
            startedAt: '2026-08-28T12:00:00.000Z',
            state: 'passed',
            executionTargetProfileIds: ['chrome'],
            specificationUris: ['features/checkout.feature'],
            resultCount: 1,
          },
        ],
        activeRunIds: [],
        retention: {},
        storage: {
          totalBytes: 0,
          warningThresholdBytes: 1,
          warning: false,
          pinnedRunIds: [],
        },
      }}
      onOpenSettings={() => {}}
      onRun={async () => {}}
    />,
  )

  expect(markup).toBe('')
})
