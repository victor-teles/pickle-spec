import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { TimelineEvidenceDetail } from '../../../../src/features/runs/result/timeline-evidence-detail'

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

test('renders action evidence through the selected timeline entry', () => {
  const markup = renderToStaticMarkup(
    <TimelineEvidenceDetail
      entry={{
        id: 'run:scenario:chrome:1:trace-0-0',
        startedAt: '2026-08-30T12:00:00.000Z',
        finishedAt: '2026-08-30T12:00:00.100Z',
        timingPrecision: 'exact',
        kind: 'Resolved action',
        title: 'Click Pay',
        state: 'passed',
        attributes: [{ label: 'Step index', value: '0' }],
        action: {
          key: '0:step-1-action-1',
          scope: {
            scenarioId: 'checkout',
            executionTargetProfileId: 'chrome',
            attempt: 1,
            stepIndex: 0,
          },
          stepText: 'When click Pay',
          precision: 'exact',
          ordinal: 0,
          description: 'Click Pay',
          evidence: {
            version: 1,
            id: 'step-1-action-1',
            ordinal: 0,
            description: 'Click Pay',
            startedAt: '2026-08-30T12:00:00.000Z',
            finishedAt: '2026-08-30T12:00:00.100Z',
            durationMs: 100,
            state: 'passed',
            source: {
              uri: 'features/checkout.feature',
              language: 'en',
              excerpt: 'When click Pay',
            },
            target: {
              before: { format: 'summary', summary: 'Checkout ready' },
              after: { format: 'summary', summary: 'Payment submitted' },
            },
            screenshots: {
              before: { state: 'not-retained' },
              after: { state: 'not-retained' },
            },
            diagnostics: [],
            activity: [],
          },
          retries: [],
        },
      }}
      attemptStartedAt="2026-08-30T12:00:00.000Z"
      scenarioName="Checkout"
      resultState="passed"
    />,
  )

  expect(markup).toContain('Before target state')
  expect(markup).toContain('Checkout ready')
  expect(markup).toContain('After target state')
  expect(markup).toContain('Payment submitted')
})
