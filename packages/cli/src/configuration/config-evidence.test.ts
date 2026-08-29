import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { loadConfig } from './config'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function loadEvidenceConfig(config: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'pickle-evidence-config-'))
  directories.push(root)
  await Bun.write(
    join(root, 'pickle.config.jsonc'),
    JSON.stringify({ schemaVersion: 1, ...config }),
  )
  return loadConfig(undefined, root)
}

test('configures run-wide and profile-specific evidence persistence', async () => {
  const config = await loadEvidenceConfig({
    evidence: { persistence: 'on-failure' },
    executionTargetProfiles: {
      browser: {
        adapter: 'web',
        evidence: { persistence: 'always' },
      },
      mobile: {
        adapter: 'mobile',
        evidence: { persistence: 'off' },
        mobile: {
          executionTarget: 'android-emulator',
          application: { id: 'dev.pickle.example', binaryPath: 'app.apk' },
        },
      },
    },
  })

  expect(config.evidence?.persistence).toBe('on-failure')
  expect(config.executionTargetProfiles?.browser?.evidence?.persistence).toBe(
    'always',
  )
  expect(config.executionTargetProfiles?.mobile?.evidence?.persistence).toBe(
    'off',
  )
})

test('rejects unsupported evidence persistence values', async () => {
  await expect(
    loadEvidenceConfig({ evidence: { persistence: 'sometimes' } }),
  ).rejects.toThrow('evidence.persistence must be off, on-failure, or always')
})
