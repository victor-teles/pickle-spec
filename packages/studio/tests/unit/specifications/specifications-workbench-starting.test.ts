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
      onCancel: () => {},
      onDismissFinishedRun: () => {},
      onInspectLocation: () => {},
      onInspectTimelineEntry: () => {},
      onPauseFollowing: () => {},
      onEditSpecification: () => {},
      onResumeFollowing: () => {},
      onRun: () => {},
      onSelectInspectorTab: () => {},
      onSelectScenario: () => {},
      onSelectSpecification: () => {},
      running: true,
    }),
  )

  expect(markup).toContain('Starting run…')
  expect(markup).not.toContain('Cancel run')
})
