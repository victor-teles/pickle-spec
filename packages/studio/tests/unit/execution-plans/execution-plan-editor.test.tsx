import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { ExecutionPlanEditor } from '../../../src/features/execution-plans/execution-plan-editor'

import { parseLocatorInput } from '../../../src/features/execution-plans/locator-form'

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
      onDiscard={() => {}}
    />,
  )

  expect(markup).toContain('Edit cached plan')
  expect(markup).toContain('When I submit the order')
  expect(markup).toContain('Edit locator')
  expect(markup).toContain('Protected check text-equals')
  expect(markup).toContain('Close draft')
  expect(markup.match(/aria-label="Plan steps"/g)).toHaveLength(1)
  expect(markup.match(/Edit locator/g)).toHaveLength(1)
  expect(markup).not.toContain('xl:grid-cols-2')
})

describe('locator form input', () => {
  test.each([
    { match: '1', nth: 0 },
    { match: '2', nth: 1 },
    { match: ' 3 ', nth: 2 },
  ])('converts match $match to API index $nth', ({ match, nth }) => {
    expect(parseLocatorInput({ selector: '#submit', match })).toEqual({
      ok: true,
      locator: { selector: { segments: [{ literal: '#submit' }] }, nth },
    })
  })

  test('keeps blank match omitted and preserves variables and literal text', () => {
    expect(
      parseLocatorInput({
        selector: '[data-id="<account.id>"] <field>',
        match: ' ',
      }),
    ).toEqual({
      ok: true,
      locator: {
        selector: {
          segments: [
            { literal: '[data-id="' },
            { variable: 'account.id' },
            { literal: '"] ' },
            { variable: 'field' },
          ],
        },
      },
    })
  })

  test.each(['0', '-1', '1.5', '1e2', 'Infinity', '9007199254740992'])(
    'rejects invalid match %s with a match-only error',
    (match) => {
      expect(parseLocatorInput({ selector: '#submit', match })).toEqual({
        ok: false,
        errors: {
          match: 'Enter a whole match number starting at 1, or leave it blank.',
        },
      })
    },
  )

  test('reports empty locator separately from a valid match', () => {
    expect(parseLocatorInput({ selector: '  ', match: '1' })).toEqual({
      ok: false,
      errors: { selector: 'Enter a locator.' },
    })
  })
})
