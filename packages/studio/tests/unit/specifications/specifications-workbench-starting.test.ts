import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { SpecificationsWorkbench } from '../../../src/features/specifications/specifications-workbench'
import { specificationsWorkbenchModel } from '../../../src/features/specifications/specifications-workbench-model'

test('opens the queue with immediate feedback while a run is starting', () => {
  const model = specificationsWorkbenchModel({
    specifications: [
      {
        id: 'checkout',
        name: 'Checkout',
        uri: 'features/checkout.feature',
        scenarios: [{ id: 'pay', name: 'Pay' }],
      },
    ],
  })
  const markup = renderToStaticMarkup(
    createElement(SpecificationsWorkbench, {
      canRunAll: true,
      model,
      onCancel: () => undefined,
      onDismissFinishedRun: () => undefined,
      onInspectLocation: () => undefined,
      onInspectTimelineEntry: () => undefined,
      onPauseFollowing: () => undefined,
      onEditSpecification: () => undefined,
      onResumeFollowing: () => undefined,
      onRun: () => undefined,
      onSelectInspectorTab: () => undefined,
      onSelectScenario: () => undefined,
      onSelectSpecification: () => undefined,
      running: true,
    }),
  )

  expect(markup).toContain('Starting run…')
  expect(markup).not.toContain('Cancel run')
})
