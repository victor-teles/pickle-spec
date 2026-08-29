import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResultViewportPanel } from './result-inspector'

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
