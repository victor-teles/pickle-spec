import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { ResultViewportPanel } from '../../../../src/runs/result/result-inspector'

test('renders local screencast frames in the viewport panel', () => {
  const markup = renderToStaticMarkup(
    <ResultViewportPanel
      scenarioName="Pay for the order"
      liveViewport={{
        kind: 'frame',
        data: 'jpeg-frame',
        mimeType: 'image/jpeg',
      }}
    />,
  )

  expect(markup).toContain('data:image/jpeg;base64,jpeg-frame')
  expect(markup).toContain('Live browser viewport for Pay for the order')
})

test('renders compact PNG device frames without browser-specific copy', () => {
  const markup = renderToStaticMarkup(
    <ResultViewportPanel
      compact
      scenarioName="Open the app"
      liveViewport={{
        kind: 'device-frame',
        data: 'png-frame',
        mimeType: 'image/png',
      }}
    />,
  )

  expect(markup).toContain('data:image/png;base64,png-frame')
  expect(markup).toContain('max-h-[36rem]')
  expect(markup).toContain('Latest device frame')
})

test('renders Browserbase live sessions with constrained iframe permissions', () => {
  const markup = renderToStaticMarkup(
    <ResultViewportPanel
      scenarioName="Pay for the order"
      liveViewport={{
        kind: 'browserbase',
        sessionId: 'session-1',
        url: 'https://www.browserbase.com/sessions/session-1',
      }}
    />,
  )

  expect(markup).toContain('https://www.browserbase.com/sessions/session-1')
  expect(markup).toContain('sandbox="allow-same-origin allow-scripts"')
  expect(markup).toContain('allow="clipboard-read; clipboard-write"')
})
