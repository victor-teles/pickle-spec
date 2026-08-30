import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { TimelineEntry } from '../../../../src/features/runs/result/result-evidence'
import { ResultEvidenceTimeline } from '../../../../src/features/runs/result/result-evidence-timeline'

function entry(
  id: string,
  kind: TimelineEntry['kind'],
  title: string,
): TimelineEntry {
  return {
    id,
    startedAt: '2026-08-22T12:00:01.000Z',
    timingPrecision: 'exact',
    kind,
    title,
    attributes: [],
  }
}

test('default Execution timeline focuses on Steps and Resolved actions', () => {
  const markup = renderToStaticMarkup(
    <ResultEvidenceTimeline
      entries={[
        entry('step-0', 'Step', 'Then payment is captured'),
        entry('action-1', 'Resolved action', 'Click Pay now'),
        entry('artifact-1', 'Test artifact', 'Checkout screenshot'),
        entry('browser-1', 'Browser activity', 'POST /checkout'),
        entry('diagnostic-1', 'Diagnostic entry', 'Console warning'),
        entry('event-2', 'Run event', 'Scenario Started'),
      ]}
      startedAt="2026-08-22T12:00:00.000Z"
      durationMs={1_000}
      state="failed"
      scenarioName="Pay for the order"
      resultState="failed"
    />,
  )

  expect(markup).toContain('Then payment is captured')
  expect(markup).toContain('Click Pay now')
  expect(markup).not.toContain('Checkout screenshot')
  expect(markup).not.toContain('Verbose timeline')
  expect(markup).toContain('Filter timeline by entry type')
  expect(markup.match(/aria-pressed="true"/g)).toHaveLength(3)
  expect(markup).toMatch(/aria-pressed="false"[^>]*>.*Test artifact/s)
  expect(markup).toMatch(/aria-pressed="false"[^>]*>.*Browser activity/s)
  expect(markup).toMatch(/aria-pressed="false"[^>]*>.*Diagnostic entry/s)
  expect(markup).toMatch(/aria-pressed="false"[^>]*>.*Run event/s)
  expect(markup).toContain('2 entries')
  expect(markup).not.toContain('POST /checkout')
  expect(markup).not.toContain('Console warning')
  expect(markup).not.toContain('Scenario Started')
})
