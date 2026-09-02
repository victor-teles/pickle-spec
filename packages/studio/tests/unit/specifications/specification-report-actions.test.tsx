import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { SpecificationHeader } from '../../../src/features/specifications/specification-header'
import { SpecificationList } from '../../../src/features/specifications/specification-list'
import type { StudioApi } from '../../../src/lib/studio-api'
import type { StudioSpecification } from '../../../src/server/contracts'

vi.mock('../../../src/features/documents/specification-editor', () => ({
  SpecificationEditor: () => null,
}))

const specification: StudioSpecification = {
  id: 'checkout',
  name: 'Checkout',
  uri: 'features/checkout.feature',
  scenarios: [],
}

const api: StudioApi = async () => {
  throw new Error('Unexpected API call')
}

function renderHeader(reportHref?: string) {
  return renderToStaticMarkup(
    <SpecificationHeader
      api={api}
      authoring={false}
      canRun
      headingRef={createRef<HTMLHeadingElement>()}
      namespaces={[]}
      onAuthoringChange={() => {}}
      onCancelRun={() => {}}
      onCatalogChange={async () => {}}
      onCreated={() => {}}
      onError={() => {}}
      onRun={() => {}}
      reportHref={reportHref}
      running={false}
      specification={specification}
    />,
  )
}

test('renders a direct report download in the selected Specification header', () => {
  const markup = renderHeader('/api/history/run%2Fone/html')

  expect(markup).toContain('href="/api/history/run%2Fone/html"')
  expect(markup).toContain('download=""')
  expect(markup).toContain('Download report')
})

test('does not render a report action in the header without a matching report', () => {
  expect(renderHeader()).not.toContain('Download report')
})

test('keeps Run all before the report and labels the download for all Specifications', () => {
  const markup = renderToStaticMarkup(
    <SpecificationList
      canRun
      onRunAll={() => {}}
      onSelect={() => {}}
      reportHref="/api/history/run-all/html"
      running={false}
      specifications={[specification]}
    />,
  )

  expect(markup.indexOf('Run all Specifications')).toBeLessThan(
    markup.indexOf('Download latest report'),
  )
  expect(markup).toContain('Run all Specifications')
  expect(markup).toContain(
    'aria-label="Download latest report for all Specifications"',
  )
  expect(markup).toContain('href="/api/history/run-all/html" download=""')
})
