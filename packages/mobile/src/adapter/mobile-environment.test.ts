import { expect, mock, test } from 'bun:test'
import {
  diagnoseMobileEnvironment,
  type MobileEnvironmentAdapterFactory,
} from '../../index'

const androidOptions = {
  executionTarget: 'android-emulator' as const,
  application: {
    id: 'com.example.checkout',
    binaryPath: '/apps/checkout.apk',
  },
}

test('discovers a booted Android Emulator and disposes the adapter', async () => {
  const dispose = mock(async () => {})
  const createAdapter: MobileEnvironmentAdapterFactory = () => ({
    async discoverTargets() {
      return [
        {
          id: 'emulator-5554',
          name: 'Pixel 9',
          state: 'booted',
          capabilities: ['android', 'android-emulator'],
        },
      ]
    },
    dispose,
  })

  await expect(
    diagnoseMobileEnvironment(
      { options: androidOptions, requiredCapabilities: ['android'] },
      createAdapter,
    ),
  ).resolves.toEqual({
    id: 'mobile.android-emulator',
    kind: 'ready',
    message: 'Android Emulator target "Pixel 9" is booted and ready',
  })
  expect(dispose).toHaveBeenCalledTimes(1)
})

test('returns Android setup remediation when discovery fails', async () => {
  const diagnostic = await diagnoseMobileEnvironment(
    { options: androidOptions },
    () => ({
      async discoverTargets() {
        throw new Error('adb was not found')
      },
    }),
  )

  expect(diagnostic).toMatchObject({
    id: 'mobile.android-emulator',
    kind: 'blocked',
    message: 'Android Emulator is not ready: adb was not found',
  })
  expect(
    diagnostic.kind === 'blocked' && diagnostic.remediation[0].summary,
  ).toContain('Install Android Studio and the Android SDK')
})

test('returns iOS setup remediation when no Simulator is booted', async () => {
  const diagnostic = await diagnoseMobileEnvironment(
    {
      options: {
        executionTarget: 'ios-simulator',
        application: {
          id: 'com.example.checkout',
          binaryPath: '/apps/Checkout.app',
        },
      },
    },
    () => ({
      async discoverTargets() {
        return []
      },
    }),
  )

  expect(diagnostic).toMatchObject({
    id: 'mobile.ios-simulator',
    kind: 'blocked',
    message:
      'iOS Simulator is not ready: no compatible booted target was found',
  })
  expect(
    diagnostic.kind === 'blocked' && diagnostic.remediation[0].summary,
  ).toContain('install Xcode and its Command Line Tools')
})
