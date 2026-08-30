import { expect, test } from 'vitest'
import { createMobileAdapter } from '../../index'
import {
  mobilePrefixPolicy,
  mobilePrefixStepCount,
  mobileReplayVariableName,
} from './mobile-execution-cache'

const productVariable = mobileReplayVariableName('product')
const productPlaceholder = ['$', `{${productVariable}}`].join('')
const defaultedProductPlaceholder = ['$', `{${productVariable}:-Pickles}`].join(
  '',
)
const androidScript = `context platform=android
open "com.example.checkout" --relaunch
find "Buy ${productPlaceholder}" click
is visible "text=\\"Receipt\\""
`

function adapter(binaryPath = '/tmp/checkout.apk') {
  return createMobileAdapter(
    {
      application: { id: 'com.example.checkout', binaryPath },
      targetId: 'emulator-5554',
    },
    () => ({
      subscribe: () => () => {},
      async request() {
        throw new Error('Unexpected worker request')
      },
      async dispose() {},
    }),
  )
}

test('validates a complete parameterized Agent Device Scenario payload', () => {
  const executionCache = adapter().executionCache

  expect(executionCache).toBeDefined()
  expect(executionCache?.adapterKind).toBe('mobile.agent-device')
  expect(executionCache?.adapterCacheSchemaVersion).toBe(
    'agent-device-ad.1+0.20.10',
  )
  expect(
    executionCache?.parse(
      {
        format: 'agent-device-ad',
        script: androidScript,
        stepRanges: [
          { from: 2, to: 2 },
          { from: 3, to: 3 },
        ],
      },
      ['product'],
    ),
  ).toEqual({
    format: 'agent-device-ad',
    script: androidScript,
    stepRanges: [
      { from: 2, to: 2 },
      { from: 3, to: 3 },
    ],
  })
})

test('rejects payloads that can persist values or target another platform', () => {
  const executionCache = adapter().executionCache
  const payload = {
    format: 'agent-device-ad',
    script: androidScript,
    stepRanges: [
      { from: 2, to: 2 },
      { from: 3, to: 3 },
    ],
  }

  expect(
    executionCache?.parse(
      {
        ...payload,
        script: androidScript.replace(productPlaceholder, 'Pickles'),
      },
      ['product'],
    ),
  ).toBeUndefined()
  expect(
    executionCache?.parse(
      { ...payload, script: androidScript.replace('android', 'ios') },
      ['product'],
    ),
  ).toBeUndefined()
  expect(
    executionCache?.parse(
      { ...payload, script: `env product=Pickles\n${androidScript}` },
      ['product'],
    ),
  ).toBeUndefined()
  expect(
    executionCache?.parse(
      {
        ...payload,
        script: androidScript.replace(
          productPlaceholder,
          defaultedProductPlaceholder,
        ),
      },
      ['product'],
    ),
  ).toBeUndefined()
  expect(
    executionCache?.parse(
      {
        ...payload,
        script: androidScript.replace(
          `find "Buy ${productPlaceholder}" click`,
          'find "Email" fill "secret@example.com"',
        ),
      },
      ['product'],
    ),
  ).toBeUndefined()
  expect(
    executionCache?.parse(
      {
        ...payload,
        script: androidScript.replace(
          'com.example.checkout',
          'com.example.another-app',
        ),
      },
      ['product'],
    ),
  ).toBeUndefined()
})

test('fingerprints deterministic mobile configuration rather than local paths', () => {
  const first = adapter('/tmp/checkout-a.apk').executionCache
  const second = adapter('/another/checkout-b.apk').executionCache
  const ios = createMobileAdapter(
    {
      executionTarget: 'ios-simulator',
      application: {
        id: 'com.example.checkout',
        binaryPath: '/tmp/Checkout.app',
      },
      targetId: 'simulator-1',
    },
    () => ({
      subscribe: () => () => {},
      async request() {
        throw new Error('Unexpected worker request')
      },
      async dispose() {},
    }),
  ).executionCache

  expect(first?.targetConfigurationFingerprint).toBe(
    second?.targetConfigurationFingerprint,
  )
  expect(first?.targetConfigurationFingerprint).not.toBe(
    ios?.targetConfigurationFingerprint,
  )
})

test('names mixed Replay as an explicit complete-scenario-only deferral', () => {
  const executionCache = adapter().executionCache
  const payload = {
    format: 'agent-device-ad' as const,
    script: androidScript,
    stepRanges: [
      { from: 2, to: 2 },
      { from: 3, to: 3 },
    ],
  }

  expect(mobilePrefixPolicy()).toEqual({
    mixedReplay: false,
    write: 'complete-scenario-only',
  })
  expect(executionCache?.prefixPolicy).toEqual(mobilePrefixPolicy())
  expect(mobilePrefixStepCount(payload)).toBe(1)
  expect(executionCache?.prefixStepCount(payload)).toBe(1)
})
