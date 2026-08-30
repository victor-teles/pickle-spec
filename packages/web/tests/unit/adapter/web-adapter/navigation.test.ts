import { describe, expect, test, vi } from 'vitest'
import { createWebAdapter } from '../../../../index'
import { requiredValue } from '../../../../src/required-value'
import { factoryFor, scenario, specification, stubAutomation } from './fixtures'

describe('createWebAdapter navigation', () => {
  test('gives explicit navigation precedence for an action step', async () => {
    const navigate = vi.fn(async () => {})
    const observe = vi.fn(async () => [])
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(stubAutomation({ navigate, observe })),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })

    const result = await session.executeStep({
      keyword: 'When',
      text: 'I navigate to /checkout',
      type: 'action',
    })
    await session.close()

    expect(result).toMatchObject({
      state: 'passed',
      resolvedActions: [
        { description: 'Navigate to https://example.test/checkout' },
      ],
    })
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(
      'https://example.test/checkout',
      undefined,
    )
    expect(observe).not.toHaveBeenCalled()
  })

  test('does not navigate when opening a logical session', async () => {
    const navigate = vi.fn(async () => {})
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(stubAutomation({ navigate })),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })
    await session.close()

    expect(navigate).not.toHaveBeenCalled()
  })

  test('navigates to baseUrl only before the first action that requires a page', async () => {
    const navigate = vi.fn(async () => {})
    const observe = vi.fn(async () => [
      { description: 'Fill the search field', handle: { selector: '#search' } },
    ])
    const act = vi.fn(async () => ({ success: true }))
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(stubAutomation({ navigate, observe, act })),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification: {
        ...specification,
        scenarios: [
          {
            name: 'Search without navigation',
            tags: [],
            steps: [
              { keyword: 'When', text: 'I search for pickles', type: 'action' },
            ],
          },
        ],
      },
      scenario: {
        name: 'Search without navigation',
        tags: [],
        steps: [
          { keyword: 'When', text: 'I search for pickles', type: 'action' },
        ],
      },
    })

    await session.executeStep({
      keyword: 'When',
      text: 'I search for pickles',
      type: 'action',
    })
    await session.close()

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('https://example.test', undefined)
  })

  test('navigates to baseUrl before the first outcome when no explicit navigation exists', async () => {
    const navigate = vi.fn(async () => {})
    const verify = vi.fn(async () => ({
      meetsExpectation: true,
      actualState: 'Ready',
    }))
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(stubAutomation({ navigate, verify })),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario: {
        name: 'Verify only',
        tags: [],
        steps: [
          {
            keyword: 'Then',
            text: 'pickle results are visible',
            type: 'outcome',
          },
        ],
      },
    })

    await session.executeStep({
      keyword: 'Then',
      text: 'pickle results are visible',
      type: 'outcome',
    })
    await session.close()

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('https://example.test', undefined)
  })

  test('does not navigate to baseUrl again after explicit navigation', async () => {
    const navigate = vi.fn(async () => {})
    const observe = vi.fn(async () => [
      { description: 'Fill the search field', handle: { selector: '#search' } },
    ])
    const act = vi.fn(async () => ({ success: true }))
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(stubAutomation({ navigate, observe, act })),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })

    await session.executeStep(requiredValue(scenario.steps[0]))
    await session.executeStep(requiredValue(scenario.steps[1]))
    await session.close()

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(
      'https://example.test/search',
      undefined,
    )
  })
})
