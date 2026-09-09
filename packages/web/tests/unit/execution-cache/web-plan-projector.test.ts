import { planDigest } from '@pickle-spec/runner'
import { describe, expect, test } from 'vitest'
import type { WebExecutionCachePayload } from '../../../index'
import {
  projectWebExecutionPlan,
  replaceWebInteractionTarget,
  validateWebExecutionPlanCandidate,
} from '../../../index'

const steps = [
  { keyword: 'When ', text: 'I sign in', type: 'action' as const },
  { keyword: 'Then ', text: 'I see the account', type: 'outcome' as const },
]

describe('readable web execution plan', () => {
  test('groups actions and checks by exact Gherkin step', () => {
    const payload: WebExecutionCachePayload = {
      schemaVersion: 1,
      steps: [
        {
          instructions: [
            {
              kind: 'click',
              locator: { selector: { segments: [{ literal: '#sign-in' }] } },
            },
          ],
        },
        {
          instructions: [
            {
              kind: 'text-contains',
              locator: { selector: { segments: [{ literal: 'main' }] } },
              expected: { segments: [{ literal: 'Welcome' }] },
            },
          ],
        },
      ],
    }

    expect(projectWebExecutionPlan(payload, steps)).toMatchObject([
      {
        index: 0,
        keyword: 'When ',
        text: 'I sign in',
        operations: [
          {
            kind: 'click',
            target: {
              selector: { segments: [{ kind: 'literal', value: '#sign-in' }] },
            },
          },
        ],
      },
      {
        index: 1,
        keyword: 'Then ',
        text: 'I see the account',
        operations: [{ kind: 'text-contains', check: 'text-contains' }],
      },
    ])
  })

  test('preserves variables and redacts input literals everywhere', () => {
    const secret = 'top-secret-value'
    const payload: WebExecutionCachePayload = {
      schemaVersion: 1,
      steps: [
        {
          instructions: [
            {
              kind: 'fill',
              locator: { selector: { segments: [{ literal: '#password' }] } },
              value: {
                segments: [{ literal: secret }, { variable: 'suffix' }],
              },
            },
          ],
        },
        {
          instructions: [
            {
              kind: 'text-equals',
              locator: {
                selector: {
                  segments: [{ literal: `[data-value="${secret}"]` }],
                },
              },
              expected: { segments: [{ literal: secret }] },
            },
          ],
        },
      ],
    }

    const projected = projectWebExecutionPlan(payload, steps)
    expect(JSON.stringify(projected)).not.toContain(secret)
    expect(projected[0]?.operations[0]?.value?.segments).toEqual([
      { kind: 'redacted' },
      { kind: 'variable', name: 'suffix' },
    ])
  })

  test('redacts credentials and sensitive query values in absolute and relative URLs', () => {
    const payload: WebExecutionCachePayload = {
      schemaVersion: 1,
      steps: [
        {
          instructions: [
            {
              kind: 'navigate',
              url: {
                segments: [
                  {
                    literal:
                      'https://user:pass@example.test/path?token=abc&view=full',
                  },
                ],
              },
            },
          ],
        },
        {
          instructions: [
            {
              kind: 'url-equals',
              expected: {
                segments: [
                  { literal: 'https://example.test/?token=' },
                  { variable: 'sessionId' },
                  { literal: 'SECRET-SUFFIX&view=full' },
                ],
              },
            },
          ],
        },
      ],
    }

    const source = JSON.stringify(projectWebExecutionPlan(payload, steps))
    expect(source).not.toContain('user:pass')
    expect(source).not.toContain('token=abc')
    expect(source).not.toContain('SECRET-SUFFIX')
    expect(source).toContain('sessionId')
    expect(source).toMatch(/redacted/i)
  })

  test('redacts standalone value checks because they may repeat an input secret', () => {
    const payload: WebExecutionCachePayload = {
      schemaVersion: 1,
      steps: [
        {
          instructions: [
            {
              kind: 'value-equals',
              locator: { selector: { segments: [{ literal: '#password' }] } },
              expected: { segments: [{ literal: 'standalone-secret' }] },
            },
          ],
        },
      ],
    }
    expect(
      JSON.stringify(projectWebExecutionPlan(payload, steps.slice(1))),
    ).not.toContain('standalone-secret')
  })

  test('rejects instructions that do not match the Gherkin step role', () => {
    const payload: WebExecutionCachePayload = {
      schemaVersion: 1,
      steps: [
        {
          instructions: [
            {
              kind: 'click',
              locator: { selector: { segments: [{ literal: '#wrong-role' }] } },
            },
          ],
        },
      ],
    }
    expect(() => projectWebExecutionPlan(payload, steps.slice(1))).toThrow(
      'does not match the Scenario step role',
    )
  })
})

describe('web execution plan editing', () => {
  const instruction = {
    kind: 'click' as const,
    locator: { selector: { segments: [{ literal: '#start-checkout' }] } },
  }
  const payload: WebExecutionCachePayload = {
    schemaVersion: 1,
    steps: [
      { instructions: [instruction] },
      {
        instructions: [
          {
            kind: 'text-equals',
            locator: { selector: { segments: [{ literal: '#total' }] } },
            expected: { segments: [{ literal: '$29.99' }] },
          },
        ],
      },
    ],
  }
  const editSteps = [
    { scenarioRevision: 'scenario-1', index: 0 },
    { scenarioRevision: 'scenario-1', index: 1 },
  ]
  const actionStep = { scenarioRevision: 'scenario-1', index: 0 }
  const outcomeStep = { scenarioRevision: 'scenario-1', index: 1 }

  test('replaces one action locator and preserves checks and order', () => {
    const result = replaceWebInteractionTarget(payload, editSteps, [], {
      step: actionStep,
      instructionIndex: 0,
      expectedInstructionDigest: planDigest(instruction),
      locator: { selector: { segments: [{ literal: '#review-order' }] } },
    })
    expect(result).toEqual({
      ok: true,
      value: {
        ...payload,
        steps: [
          {
            instructions: [
              {
                kind: 'click',
                locator: {
                  selector: { segments: [{ literal: '#review-order' }] },
                },
              },
            ],
          },
          payload.steps[1],
        ],
      },
    })
  })

  test('rejects stale, invalid, protected, and unsupported edits', () => {
    const stale = replaceWebInteractionTarget(payload, editSteps, [], {
      step: actionStep,
      instructionIndex: 0,
      expectedInstructionDigest: '0'.repeat(64),
      locator: { selector: { segments: [{ literal: '#review-order' }] } },
    })
    expect(stale).toMatchObject({ ok: false, reason: 'write-conflict' })

    const protectedInstruction = payload.steps[1]?.instructions[0]
    if (!protectedInstruction) throw new Error('Missing protected fixture')
    const protectedEdit = replaceWebInteractionTarget(payload, editSteps, [], {
      step: outcomeStep,
      instructionIndex: 0,
      expectedInstructionDigest: planDigest(protectedInstruction),
      locator: { selector: { segments: [{ literal: '#other' }] } },
    })
    expect(protectedEdit).toMatchObject({
      ok: false,
      reason: 'assertion-change',
    })

    const unknownVariable = replaceWebInteractionTarget(
      payload,
      editSteps,
      [],
      {
        step: actionStep,
        instructionIndex: 0,
        expectedInstructionDigest: planDigest(instruction),
        locator: { selector: { segments: [{ variable: 'ghost' }] } },
      },
    )
    expect(unknownVariable).toMatchObject({
      ok: false,
      reason: 'invalid-payload',
    })

    const navigation = {
      kind: 'navigate' as const,
      url: { segments: [{ literal: 'https://example.test/checkout' }] },
    }
    const protectedNavigation = replaceWebInteractionTarget(
      {
        schemaVersion: 1,
        steps: [{ instructions: [navigation] }],
      },
      editSteps,
      [],
      {
        step: actionStep,
        instructionIndex: 0,
        expectedInstructionDigest: planDigest(navigation),
        locator: { selector: { segments: [{ literal: '#other' }] } },
      },
    )
    expect(protectedNavigation).toMatchObject({
      ok: false,
      reason: 'assertion-change',
    })
  })
})

describe('web execution plan validation', () => {
  const scenarioSteps = [
    { keyword: 'When ', text: 'I buy one item', type: 'action' as const },
    { keyword: 'Then ', text: 'the total is $29.99', type: 'outcome' as const },
  ]
  const validationSteps = scenarioSteps.map((_, index) => ({
    scenarioRevision: 'scenario-1',
    index,
  }))
  const baseline: WebExecutionCachePayload = {
    schemaVersion: 1,
    steps: [
      {
        instructions: [
          {
            kind: 'click',
            locator: { selector: { segments: [{ literal: '#buy' }] } },
          },
        ],
      },
      {
        instructions: [
          {
            kind: 'text-equals',
            locator: { selector: { segments: [{ literal: '#total' }] } },
            expected: { segments: [{ literal: '$29.99' }] },
          },
        ],
      },
    ],
  }

  test('accepts only a complete locator repair and retains the assertion basis', () => {
    const candidate: WebExecutionCachePayload = structuredClone(baseline)
    const action = candidate.steps[0]
    if (!action) throw new Error('Missing action fixture')
    action.instructions[0] = {
      kind: 'click',
      locator: { selector: { segments: [{ literal: '#buy-now' }] } },
    }
    const result = validateWebExecutionPlanCandidate({
      baselinePayload: baseline,
      candidatePayload: candidate,
      steps: validationSteps,
      scenarioRevision: 'scenario-1',
      scenarioSteps,
      requiredVariables: [],
    })
    expect(result).toMatchObject({ ok: true, value: { payload: candidate } })
    if (!result.ok) throw new Error(result.message)
    expect(result.value.assertionDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  test('rejects a business assertion change and an incomplete candidate', () => {
    const changedAssertion: WebExecutionCachePayload = structuredClone(baseline)
    const outcome = changedAssertion.steps[1]
    if (!outcome) throw new Error('Missing outcome fixture')
    outcome.instructions[0] = {
      kind: 'text-equals',
      locator: { selector: { segments: [{ literal: '#total' }] } },
      expected: { segments: [{ literal: '$39.99' }] },
    }
    expect(
      validateWebExecutionPlanCandidate({
        baselinePayload: baseline,
        candidatePayload: changedAssertion,
        steps: validationSteps,
        scenarioRevision: 'scenario-1',
        scenarioSteps,
        requiredVariables: [],
      }),
    ).toMatchObject({ ok: false, reason: 'assertion-change' })
    expect(
      validateWebExecutionPlanCandidate({
        baselinePayload: baseline,
        candidatePayload: { ...baseline, steps: baseline.steps.slice(0, 1) },
        steps: validationSteps,
        scenarioRevision: 'scenario-1',
        scenarioSteps,
        requiredVariables: [],
      }),
    ).toMatchObject({ ok: false, reason: 'incomplete-plan' })
  })
})
