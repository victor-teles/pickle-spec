import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { TimelineEntry } from './result-evidence'
import { ResultEvidenceTimeline } from './result-evidence-timeline'

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

test('default Execution timeline hides Run events and counts visible entries', () => {
  const markup = renderToStaticMarkup(
    <ResultEvidenceTimeline
      entries={[
        entry('step-0', 'Step', 'Then payment is captured'),
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
  expect(markup).toContain('Verbose timeline')
  expect(markup).toContain('1 entry')
  expect(markup).not.toContain('Scenario Started')
  expect(markup).not.toContain('2 entries')
})
