import { describe, expect, test } from 'vitest'
import {
  createWebAdapter,
  parseWebExecutionCachePayload,
  type WebExecutionCachePayload,
} from '../../../index'
import {
  compileObservedWebAction,
  compileWebAssertion,
  parameterizeWebValue,
} from '../../../src/execution-cache/web-execution-cache'
import { requiredValue } from '../../../src/required-value'

const variableTemplate = (name: string) => ({
  segments: [{ variable: name }],
})

const literalTemplate = (literal: string) => ({
  segments: [{ literal }],
})

describe('web Execution cache payload', () => {
  test('strictly accepts the closed action and assertion vocabulary', () => {
    const payload: WebExecutionCachePayload = {
      schemaVersion: 1,
      steps: [
        {
          instructions: [
            { kind: 'navigate', url: literalTemplate('https://example.test') },
            {
              kind: 'fill',
              locator: { selector: literalTemplate('#email') },
              value: variableTemplate('email'),
            },
            {
              kind: 'wait-for',
              locator: { selector: literalTemplate('#ready') },
              state: 'visible',
            },
          ],
        },
        {
          instructions: [
            {
              kind: 'text-equals',
              locator: { selector: literalTemplate('#account') },
              expected: variableTemplate('email'),
            },
          ],
        },
      ],
    }

    expect(parseWebExecutionCachePayload(payload, ['email'])).toEqual(payload)
  })

  test('rejects unknown operations, fields, and variable names', () => {
    expect(
      parseWebExecutionCachePayload(
        {
          schemaVersion: 1,
          steps: [
            {
              instructions: [
                {
                  kind: 'evaluate',
                  javascript: 'document.body.remove()',
                },
              ],
            },
          ],
        },
        [],
      ),
    ).toBeUndefined()
    expect(
      parseWebExecutionCachePayload(
        {
          schemaVersion: 1,
          steps: [
            {
              instructions: [
                {
                  kind: 'click',
                  locator: { selector: literalTemplate('#submit') },
                  callback: 'afterClick',
                },
              ],
            },
          ],
        },
        [],
      ),
    ).toBeUndefined()
    expect(
      parseWebExecutionCachePayload(
        {
          schemaVersion: 1,
          steps: [
            {
              instructions: [
                {
                  kind: 'fill',
                  locator: { selector: literalTemplate('#email') },
                  value: variableTemplate('secret'),
                },
              ],
            },
          ],
        },
        ['email'],
      ),
    ).toBeUndefined()
  })

  test('only parameterizes runtime values proven by a value-free source template', () => {
    const bindings = [{ name: 'email', value: 'Alice "QA"+test@example.test' }]

    expect(
      parameterizeWebValue(requiredValue(bindings[0]).value, bindings, {
        template: '<email>',
      }),
    ).toEqual(variableTemplate('email'))
    expect(
      parameterizeWebValue(requiredValue(bindings[0]).value, bindings),
    ).toBeUndefined()
    expect(
      parameterizeWebValue(
        JSON.stringify(requiredValue(bindings[0]).value),
        bindings,
      ),
    ).toBeUndefined()
    expect(
      parameterizeWebValue(
        'Alice\\ \\"QA\\"\\+test\\@example\\.test',
        bindings,
      ),
    ).toBeUndefined()
  })

  test('does not cache AI-derived selectors in parameterized Scenarios', () => {
    const bindings = [{ name: 'email', value: 'Alice+QA@example.test' }]

    expect(
      compileObservedWebAction(
        {
          selector: '[data-email="Alice\\+QA\\@example\\.test"]',
          method: 'click',
        },
        bindings,
      ),
    ).toBeUndefined()
    expect(
      compileObservedWebAction(
        {
          selector: `[data-email=${JSON.stringify(requiredValue(bindings[0]).value)}]`,
          method: 'click',
        },
        bindings,
      ),
    ).toBeUndefined()
    expect(
      compileWebAssertion(
        {
          kind: 'count-equals',
          selector: '.item',
          nth: 1,
          expected: 2,
        },
        bindings,
      ),
    ).toBeUndefined()
  })
})

describe('web target configuration fingerprint', () => {
  test('tracks Replay structure while ignoring model credentials and artifacts', () => {
    const baseline = createWebAdapter({
      baseUrl: 'https://example.test',
      browser: {
        modelName: 'google/gemini-3.6-flash',
        modelApiKey: 'first-secret',
      },
      screenshots: { mode: 'off' },
    }).executionCache?.targetConfigurationFingerprint
    const inferenceAndArtifactChanges = createWebAdapter({
      screenshots: { mode: 'on-step', outputDir: './different' },
      browser: {
        modelApiKey: 'second-secret',
        modelName: 'anthropic/claude-sonnet-4-6',
      },
      baseUrl: 'https://example.test',
    }).executionCache?.targetConfigurationFingerprint
    const differentTarget = createWebAdapter({
      baseUrl: 'https://other.example.test',
    }).executionCache?.targetConfigurationFingerprint

    expect(baseline).toBe(inferenceAndArtifactChanges)
    expect(differentTarget).not.toBe(baseline)
  })

  test('changes when direct browser behavior changes', () => {
    const baseline = createWebAdapter({
      baseUrl: 'https://example.test',
    }).executionCache?.targetConfigurationFingerprint
    const variants = [
      createWebAdapter({
        baseUrl: 'https://example.test',
        browser: { environment: 'browserbase' },
      }),
      createWebAdapter({
        baseUrl: 'https://example.test',
        browser: { headless: false },
      }),
      createWebAdapter({
        baseUrl: 'https://example.test',
        browser: { actTimeoutMs: 20_000 },
      }),
      createWebAdapter({
        baseUrl: 'https://example.test',
        profile: 'fast',
      }),
    ]

    for (const adapter of variants) {
      expect(adapter.executionCache?.targetConfigurationFingerprint).not.toBe(
        baseline,
      )
    }
  })

  test('uses a value-free CDP identity without launch-only headless state', () => {
    const local = createWebAdapter({
      baseUrl: 'https://example.test',
    }).executionCache?.targetConfigurationFingerprint
    const firstCdp = createWebAdapter({
      baseUrl: 'https://example.test',
      browser: {
        cdpUrl: 'wss://first.example.test/session?token=first-secret',
        cdpExtensionId: 'first-extension',
        headless: false,
      },
    }).executionCache?.targetConfigurationFingerprint
    const sameEndpointCdp = createWebAdapter({
      baseUrl: 'https://example.test',
      browser: {
        environment: 'local',
        cdpUrl: 'wss://first.example.test/other-session?token=second-secret',
        cdpExtensionId: 'second-extension',
        headless: true,
      },
    }).executionCache?.targetConfigurationFingerprint
    const differentEndpointCdp = createWebAdapter({
      baseUrl: 'https://example.test',
      browser: {
        cdpUrl: 'https://second.example.test/session?token=second-secret',
      },
    }).executionCache?.targetConfigurationFingerprint

    expect(firstCdp).not.toBe(local)
    expect(sameEndpointCdp).toBe(firstCdp)
    expect(differentEndpointCdp).not.toBe(firstCdp)
  })

  test('keeps existing non-CDP fingerprints unchanged', () => {
    expect(
      createWebAdapter({
        baseUrl: 'https://example.test',
      }).executionCache?.targetConfigurationFingerprint,
    ).toBe('949667228330a3ecee5a9bbf31cfc83496c84058e36d05fbd2d2d2a70d6e812d')
    expect(
      createWebAdapter({
        baseUrl: 'https://example.test',
        browser: { environment: 'browserbase' },
      }).executionCache?.targetConfigurationFingerprint,
    ).toBe('213e0f64d53c65ceabf82bf2e902b11c665fb006574e0c3450f734c9d86222bd')
  })
})
