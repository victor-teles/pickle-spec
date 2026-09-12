import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { ExecutionPlanEditor } from '../../../src/features/execution-plans/execution-plan-editor'

import { parseLocatorInput } from '../../../src/features/execution-plans/locator-form'

const plan = {
  state: 'available' as const,
  source: 'current-cache-entry' as const,
  sourceNotice: 'Replay uses this plan',
  cacheRevision: 1,
  cacheDigest: 'a'.repeat(64),
  publication: { sourceRunId: 'run-1' },
  applicability: { state: 'applicable' as const },
  cacheKey: {
    projectKey: 'project-1',
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

test('opens the plan editor without a draft or activation step', () => {
  const markup = renderToStaticMarkup(
    <ExecutionPlanEditor
      plan={plan}
      onSave={async () => ({ ok: true, value: plan })}
      onReload={() => {}}
    />,
  )

  expect(markup).toContain('Execution plan canvas')
  expect(markup).not.toMatch(/draft|inactive|activation/i)
  expect(markup).toContain('Reload plan')
  expect(markup).not.toContain('Edit action locator')
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
