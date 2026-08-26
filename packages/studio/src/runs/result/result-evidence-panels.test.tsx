import { expect, test } from 'bun:test'
import type { ScenarioAttempt } from '@pickle-spec/runner'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArtifactViewer } from './artifact-viewer'
import { ResultDiagnostics } from './result-evidence-panels'

const diagnosticsAvailability: ScenarioAttempt['evidenceAvailability'] = [
  { kind: 'diagnostics', state: 'available' },
]

test('renders an accessible bounded page for a 10,000-entry Diagnostic set', () => {
  const diagnostics = Array.from({ length: 10_000 }, (_, index) => ({
    id: `diagnostic-${index}`,
    occurredAt: new Date(Date.UTC(2026, 7, 24, 12, 0, 0, index)).toISOString(),
    timingPrecision: 'exact' as const,
    level: 'info' as const,
    origin: 'adapter' as const,
    source: 'Scenario attempt' as const,
    message: `Diagnostic message marker-${index}`,
  }))

  const markup = renderToStaticMarkup(
    <ResultDiagnostics
      diagnostics={diagnostics}
      availability={diagnosticsAvailability}
    />,
  )

  expect(markup).toContain('Search Diagnostic entries')
  expect(markup).toContain('aria-live="polite"')
  expect(markup).toContain(
    'Showing 1–100 of 10000 matching Diagnostic entries (10000 total).',
  )
  expect(markup).toContain('Diagnostic message marker-99')
  expect(markup).not.toContain('Diagnostic message marker-100')
  expect(markup).not.toContain('Diagnostic message marker-9999')
  expect(markup).toContain('Next 100')
})

test('keeps media and text payloads unloaded until investigation requests them', () => {
  const recording = renderToStaticMarkup(
    <ArtifactViewer
      artifact={{
        kind: 'recording',
        path: '/tmp/recording.mp4',
        mediaType: 'video/mp4',
      }}
      resultState="failed"
      scenarioName="Checkout"
      stepText="Then payment succeeds"
    />,
  )
  const deviceLog = renderToStaticMarkup(
    <ArtifactViewer
      artifact={{
        kind: 'device-log',
        path: '/tmp/device.log',
        mediaType: 'text/plain',
      }}
      resultState="failed"
      scenarioName="Checkout"
      stepText="Then payment succeeds"
    />,
  )

  expect(recording).toContain('Load recording')
  expect(recording).not.toContain('<video')
  expect(deviceLog).toContain('Load device log')
  expect(deviceLog).not.toContain('<pre')
})
