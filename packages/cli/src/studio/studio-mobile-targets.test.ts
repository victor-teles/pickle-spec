import type {
  MobileAdapterOptions,
  MobileExecutionTargetAdapter,
} from '@pickle-spec/mobile'
import { expect, test } from 'vitest'
import type { PickleConfig } from '../configuration/config'
import { requiredValue } from '../required-value'
import {
  discoverStudioMobileTargets,
  studioMobileEnvironmentAdapterFactory,
  validateStudioMobileTargetCapabilities,
} from './studio-mobile-targets'

const config: PickleConfig = {
  schemaVersion: 1,
  executionTargetProfiles: {
    web: { adapter: 'web' },
    android: {
      adapter: 'mobile',
      capabilities: ['android', 'screenshots'],
      mobile: {
        executionTarget: 'android-emulator',
        application: {
          id: 'com.example.checkout',
          binaryPath: '/apps/checkout.apk',
        },
      },
    },
    ios: {
      adapter: 'mobile',
      capabilities: ['ios', 'screenshots'],
      mobile: {
        executionTarget: 'ios-simulator',
        application: {
          id: 'com.example.checkout',
          binaryPath: '/apps/Checkout.app',
        },
      },
    },
  },
}

test('discovers Android Emulator and iOS Simulator targets per configured profile', async () => {
  const disposed: string[] = []
  const createAdapter = (
    options: MobileAdapterOptions,
  ): MobileExecutionTargetAdapter => {
    const executionTarget = options.executionTarget ?? 'android-emulator'
    return {
      capabilities: [executionTarget],
      async discoverTargets() {
        return [
          {
            id:
              executionTarget === 'ios-simulator'
                ? 'simulator-iphone-16'
                : 'emulator-5554',
            name:
              executionTarget === 'ios-simulator'
                ? 'iPhone 16 Pro'
                : 'Pixel 9 API 35',
            state: 'booted',
            capabilities: [executionTarget],
          },
        ]
      },
      async openSession() {
        throw new Error('Discovery must not open a logical session')
      },
      async dispose() {
        disposed.push(executionTarget)
      },
    }
  }

  expect(await discoverStudioMobileTargets(config, createAdapter)).toEqual([
    {
      profileId: 'android',
      executionTarget: 'android-emulator',
      targets: [
        {
          id: 'emulator-5554',
          name: 'Pixel 9 API 35',
          state: 'booted',
          capabilities: ['android-emulator'],
        },
      ],
    },
    {
      profileId: 'ios',
      executionTarget: 'ios-simulator',
      targets: [
        {
          id: 'simulator-iphone-16',
          name: 'iPhone 16 Pro',
          state: 'booted',
          capabilities: ['ios-simulator'],
        },
      ],
    },
  ])
  expect(disposed).toEqual(['android-emulator', 'ios-simulator'])
})

test('keeps discovery failures scoped to their execution target profile', async () => {
  const createAdapter = (
    options: MobileAdapterOptions,
  ): MobileExecutionTargetAdapter => ({
    async discoverTargets() {
      if (options.executionTarget === 'ios-simulator') {
        throw new Error('No iOS Simulator runtime is provisioned')
      }
      return []
    },
    async openSession() {
      throw new Error('Discovery must not open a logical session')
    },
  })

  expect(await discoverStudioMobileTargets(config, createAdapter)).toEqual([
    {
      profileId: 'android',
      executionTarget: 'android-emulator',
      targets: [],
    },
    {
      profileId: 'ios',
      executionTarget: 'ios-simulator',
      targets: [],
      error: 'No iOS Simulator runtime is provisioned',
    },
  ])
})

test('rejects selected target capability mismatches before a mobile session opens', () => {
  const targetConfig: PickleConfig = {
    ...config,
    executionTargetProfiles: {
      android: {
        ...requiredValue(requiredValue(config.executionTargetProfiles).android),
        capabilities: ['android', 'screenshots', 'device-logs'],
        mobile: {
          ...requiredValue(
            requiredValue(requiredValue(config.executionTargetProfiles).android)
              .mobile,
          ),
          targetId: 'emulator-5554',
        },
      },
    },
  }

  expect(() =>
    validateStudioMobileTargetCapabilities(targetConfig, [
      {
        profileId: 'android',
        executionTarget: 'android-emulator',
        targets: [
          {
            id: 'emulator-5554',
            name: 'Pixel 9 API 35',
            state: 'booted',
            capabilities: ['android', 'screenshots'],
          },
        ],
      },
    ]),
  ).toThrow(
    'Selected target "Pixel 9 API 35" for execution target profile "android" lacks configured capabilities: device-logs',
  )
})

test('does not dispose a shared extension adapter after discovery', async () => {
  let disposed = false
  const sharedAdapter: MobileExecutionTargetAdapter = {
    async discoverTargets() {
      return []
    },
    async openSession() {
      throw new Error('Discovery must not open a logical session')
    },
    async dispose() {
      disposed = true
    },
  }
  const androidOnly: PickleConfig = {
    ...config,
    executionTargetProfiles: {
      android: requiredValue(
        requiredValue(config.executionTargetProfiles).android,
      ),
    },
  }
  const adapterNameFallback: MobileExecutionTargetAdapter = {
    async discoverTargets() {
      throw new Error('The profile-specific adapter must take precedence')
    },
    async openSession() {
      throw new Error('Discovery must not open a logical session')
    },
  }

  await discoverStudioMobileTargets(
    androidOnly,
    () => {
      throw new Error('The configured shared adapter must be reused')
    },
    {
      android: sharedAdapter,
      mobile: adapterNameFallback,
    },
  )

  const environmentFactory = requiredValue(
    studioMobileEnvironmentAdapterFactory(
      { android: sharedAdapter, mobile: adapterNameFallback },
      'android',
    ),
  )
  const environmentAdapter = environmentFactory(
    requiredValue(
      requiredValue(requiredValue(androidOnly.executionTargetProfiles).android)
        .mobile,
    ),
  )
  await environmentAdapter.discoverTargets()
  await environmentAdapter.dispose?.()

  expect(disposed).toBe(false)
})

test('reuses an adapter-name extension when no profile-specific adapter exists', async () => {
  let disposed = false
  const sharedAdapter: MobileExecutionTargetAdapter = {
    async discoverTargets() {
      return [
        {
          id: 'shared-emulator',
          name: 'Shared Android Emulator',
          state: 'booted',
          capabilities: ['android'],
        },
      ]
    },
    async openSession() {
      throw new Error('Discovery must not open a logical session')
    },
    async dispose() {
      disposed = true
    },
  }
  const androidOnly: PickleConfig = {
    ...config,
    executionTargetProfiles: {
      android: requiredValue(
        requiredValue(config.executionTargetProfiles).android,
      ),
    },
  }

  const discoveries = await discoverStudioMobileTargets(
    androidOnly,
    () => {
      throw new Error('The shared adapter-name extension must be reused')
    },
    { mobile: sharedAdapter },
  )

  expect(discoveries[0]?.targets[0]?.id).toBe('shared-emulator')
  expect(disposed).toBe(false)
})
