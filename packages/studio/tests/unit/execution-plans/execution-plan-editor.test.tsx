import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { ExecutionPlanEditor } from '../../../src/features/execution-plans/execution-plan-editor'

const draft = {
  state: 'draft' as const,
  revisionId: 'a'.repeat(64),
  parentRevisionId: null,
  sourceNotice: 'Draft stays inactive',
  scope: {
    scenarioId: 'scenario-1',
    scenarioRevision: 'scenario-revision-1',
    executionTargetProfileId: 'browser',
    targetConfigurationFingerprint: 'fingerprint',
    applicationRevision: 'app-1',
    adapterKind: 'web',
    adapterCacheSchemaVersion: '1',
  },
  requiredVariables: [],
  steps: [
    {
      index: 0,
      keyword: 'When ',
      text: 'I submit the order',
      operations: [
        {
          index: 0,
          kind: 'click',
          summary: 'Click',
          target: {
            selector: {
              segments: [{ kind: 'literal' as const, value: '#submit' }],
            },
          },
          editable: { instructionDigest: 'b'.repeat(64) },
        },
        {
          index: 1,
          kind: 'text-equals',
          summary: 'Check text-equals',
          check: 'text-equals',
        },
      ],
    },
  ],
  uncachedTail: [],
}

test('renders the draft editor beside its Scenario step and protected checks', () => {
  const markup = renderToStaticMarkup(
    <ExecutionPlanEditor
      draft={draft}
      onSave={async () => ({ ok: true, value: draft })}
      onDiscard={() => undefined}
    />,
  )

  expect(markup).toContain('Edit cached plan')
  expect(markup).toContain('When I submit the order')
  expect(markup).toContain('Change locator')
  expect(markup).toContain('Protected check text-equals')
  expect(markup).toContain('Discard draft')
})
