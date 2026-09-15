import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { loadEnvironment } from '../../../src/configuration/environment'

test('loads project environment files in order while preserving shell values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pickle-environment-'))
  const previousMode = process.env.NODE_ENV
  const key = `PICKLE_ENV_TEST_${crypto.randomUUID().replaceAll('-', '')}`
  try {
    process.env.NODE_ENV = 'test'
    await writeFile(join(root, '.env'), `${key}=base\n`)
    await writeFile(join(root, '.env.test'), `${key}=mode\n`)
    await writeFile(join(root, '.env.local'), `${key}=local\n`)
    loadEnvironment(root)
    expect(process.env[key]).toBe('local')
    process.env[key] = 'shell'
    loadEnvironment(root)
    expect(process.env[key]).toBe('shell')
  } finally {
    delete process.env[key]
    if (previousMode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousMode
    await rm(root, { recursive: true, force: true })
  }
})

test('allows projects without environment files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pickle-environment-empty-'))
  try {
    expect(() => loadEnvironment(root)).not.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
