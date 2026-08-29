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

async function loadApplicationOutputConfig(config: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'pickle-application-output-'))
  directories.push(root)
  await Bun.write(
    join(root, 'pickle.config.jsonc'),
    JSON.stringify({ schemaVersion: 1, ...config }),
  )
  return loadConfig(undefined, root)
}

test('configures managed application output independently for a profile', async () => {
  const config = await loadApplicationOutputConfig({
    executionTargetProfiles: {
      browser: {
        adapter: 'web',
        applicationOutput: { stdout: true, stderr: false },
      },
    },
  })

  expect(config.executionTargetProfiles?.browser?.applicationOutput).toEqual({
    stdout: true,
    stderr: false,
  })
})

test('configures managed application output for every run', async () => {
  const config = await loadApplicationOutputConfig({
    server: {
      command: 'bun app.ts',
      port: 3000,
      output: { stderr: true },
    },
  })

  expect(config.server?.output).toEqual({ stderr: true })
})

test('rejects non-boolean managed application output settings', async () => {
  await expect(
    loadApplicationOutputConfig({
      executionTargetProfiles: {
        browser: {
          adapter: 'web',
          applicationOutput: { stdout: 'yes' },
        },
      },
    }),
  ).rejects.toThrow(
    'executionTargetProfiles.applicationOutput.stdout must be a boolean',
  )
})
