import type { ActionEvidence } from '@pickle-spec/runner'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { ActionEvidenceDetail } from '../../../../src/features/runs/result/action-evidence-detail'
import type { TimeTravelAction } from '../../../../src/features/runs/result/time-travel-inspection'

const evidence: ActionEvidence = {
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
    line: 4,
    column: 5,
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
  diagnostics: [
    {
      occurredAt: '2026-08-30T12:00:00.050Z',
      level: 'warning',
      origin: 'console',
      message: 'Payment request retried',
    },
  ],
  activity: [],
}

const action: TimeTravelAction = {
  key: '0:step-1-action-1',
  scope: {
    scenarioId: 'checkout',
    executionTargetProfileId: 'chrome',
    attempt: 2,
    stepIndex: 0,
  },
  stepText: 'When click Pay',
  precision: 'exact',
  ordinal: 0,
  description: evidence.description,
  evidence,
  retries: [
    { attempt: 1, state: 'failed', current: false },
    { attempt: 2, state: 'passed', current: true },
  ],
}

test('renders retry and before-after evidence for one action', () => {
  const markup = renderToStaticMarkup(
    <ActionEvidenceDetail
      action={action}
      resultState="passed"
      scenarioName="Checkout"
    />,
  )

  expect(markup).toContain('Before target state')
  expect(markup).toContain('After target state')
  expect(markup).toContain('Attempt 1 failed')
  expect(markup).toContain('Attempt 2 passed current')
  expect(markup).toContain('Payment request retried')
  expect(markup).toContain('features/checkout.feature:4')
})
