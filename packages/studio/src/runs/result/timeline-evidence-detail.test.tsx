import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { TimelineEvidenceDetail } from './timeline-evidence-detail'

test('renders captured screenshots and recordings in the selected timeline entry', () => {
  const markup = renderToStaticMarkup(
    <TimelineEvidenceDetail
      entry={{
        id: 'run:scenario:chrome:1:step-1',
        startedAt: '2026-08-22T12:00:00.400Z',
        finishedAt: '2026-08-22T12:00:01.000Z',
        timingPrecision: 'exact',
        kind: 'Step',
        title: 'Then payment is captured',
        attributes: [{ label: 'Step index', value: '1' }],
        artifacts: [
          {
            kind: 'screenshot',
            path: '/tmp/step-02-failed.png',
            mediaType: 'image/png',
          },
          {
            kind: 'recording',
            path: '/tmp/scenario.mp4',
            mediaType: 'video/mp4',
          },
        ],
      }}
      attemptStartedAt="2026-08-22T12:00:00.000Z"
      scenarioName="Pay for the order"
      resultState="failed"
    />,
  )

  expect(markup).toContain(
    'screenshot from failed result for Pay for the order: Then payment is captured',
  )
  expect(markup).toContain('aria-label="Selected timeline entry"')
  expect(markup).toContain('Open screenshot preview')
  expect(markup).toContain('Load recording')
  expect(markup).not.toContain('<video')
  expect(markup).not.toContain('href="/api/artifact')
})
