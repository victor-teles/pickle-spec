import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from './config'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function loadMobileConfig(mobile: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'pickle-mobile-config-'))
  directories.push(root)
  await Bun.write(
    join(root, 'pickle.config.jsonc'),
    JSON.stringify({
      schemaVersion: 1,
      executionTargetProfiles: {
        android: { adapter: 'mobile', mobile },
      },
    }),
  )
  return loadConfig(undefined, root)
}

test('trims mobile application and operational target paths', async () => {
  const config = await loadMobileConfig({
    executionTarget: 'android-emulator',
    application: {
      id: '  com.example.checkout  ',
      binaryPath: '  /apps/checkout.apk  ',
    },
    targetId: '  emulator-5554  ',
    artifactDirectory: '  /artifacts/mobile  ',
    nodePath: '  /opt/node/bin/node  ',
  })

  expect(config.executionTargetProfiles?.android?.mobile).toMatchObject({
    application: {
      id: 'com.example.checkout',
      binaryPath: '/apps/checkout.apk',
    },
    targetId: 'emulator-5554',
    artifactDirectory: '/artifacts/mobile',
    nodePath: '/opt/node/bin/node',
  })
})

test.each([
  ['application.id', { id: '   ', binaryPath: '/apps/checkout.apk' }],
  ['application.binaryPath', { id: 'com.example.checkout', binaryPath: '  ' }],
] as const)('rejects a blank mobile %s', async (field, application) => {
  expect(
    loadMobileConfig({ executionTarget: 'android-emulator', application }),
  ).rejects.toThrow(`executionTargetProfiles.mobile.${field} must not be empty`)
})

test.each(['targetId', 'artifactDirectory', 'nodePath'] as const)(
  'rejects a blank mobile %s',
  async (field) => {
    expect(
      loadMobileConfig({
        executionTarget: 'android-emulator',
        application: {
          id: 'com.example.checkout',
          binaryPath: '/apps/checkout.apk',
        },
        [field]: '   ',
      }),
    ).rejects.toThrow(
      `executionTargetProfiles.mobile.${field} must not be empty`,
    )
  },
)
