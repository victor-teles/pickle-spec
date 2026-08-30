import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { StudioProject, StudioRunsIndex } from '../server/contracts'
import { RunsArea } from './runs'

const project: StudioProject = {
  name: 'shop',
  root: '/shop',
  profiles: ['chrome'],
  suites: ['smoke'],
  specifications: [
    {
      id: 'checkout',
      name: 'Checkout',
      uri: 'features/checkout.feature',
      scenarios: [],
    },
  ],
}

const index: StudioRunsIndex = {
  activeRunIds: ['run-active'],
  runs: [
    {
      id: 'run-active',
      startedAt: '2026-08-30T12:01:00.000Z',
      state: 'failed',
      executionTargetProfileIds: ['chrome'],
      specificationUris: ['features/checkout.feature'],
      resultCount: 0,
    },
    {
      id: 'run-failed',
      startedAt: '2026-08-30T12:00:00.000Z',
      finishedAt: '2026-08-30T12:00:01.000Z',
      state: 'failed',
      executionTargetProfileIds: ['chrome'],
      specificationUris: ['features/checkout.feature'],
      suite: 'smoke',
      resultCount: 1,
    },
  ],
  retention: {},
  storage: {
    totalBytes: 1024,
    warningThresholdBytes: 2048,
    warning: false,
    pinnedRunIds: [],
  },
}

test('composes the Runs dashboard without duplicating active runs in history', () => {
  const markup = renderToStaticMarkup(
    <RunsArea
      api={async () => {
        throw new Error('The static dashboard should not fetch during render')
      }}
      index={index}
      project={project}
      route={{ kind: 'runs', filters: {} }}
      runsBlocked={false}
      onCancel={() => {}}
      onError={() => {}}
      onNavigate={() => {}}
      onRerun={async () => {}}
      reloadIndex={async () => index}
    />,
  )

  expect(markup).toContain('aria-labelledby="runs-title"')
  expect(markup).toContain('Search Runs')
  expect(markup).toContain('Compare selected runs')
  expect(markup).toContain('Active Runs')
  expect(markup).toContain('run-active')
  expect(markup).toContain('aria-label="Test run history"')
  expect(markup).toContain('Open attempt for run-failed')
  expect(markup.match(/run-active/g)).toHaveLength(1)
  expect(markup).toContain('Local Test run storage')
})
