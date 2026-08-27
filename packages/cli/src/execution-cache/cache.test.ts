import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ExecutionCacheEnvelope,
  type ExecutionCachePayloadValidator,
  openLocalExecutionCache,
  serializeExecutionCacheEnvelope,
} from '@pickle-spec/runner'
import { loadConfig } from '../configuration/config'
import { runCacheCommand } from './cache'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function tempRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `${name}-`))
  roots.push(root)
  return root
}

describe('Execution cache configuration', () => {
  test('loads a positive cache budget and rejects invalid values', async () => {
    const projectRoot = await tempRoot('pickle-project')
    await Bun.write(
      join(projectRoot, 'valid.jsonc'),
      JSON.stringify({ schemaVersion: 1, cache: { maxBytes: 4096 } }),
    )
    await Bun.write(
      join(projectRoot, 'invalid.jsonc'),
      JSON.stringify({ schemaVersion: 1, cache: { maxBytes: 0 } }),
    )

    expect(await loadConfig('valid.jsonc', projectRoot)).toMatchObject({
      cache: { maxBytes: 4096 },
    })
    await expect(loadConfig('invalid.jsonc', projectRoot)).rejects.toThrow(
      'cache.maxBytes must be an integer greater than or equal to 1',
    )
  })
})

describe('pickle cache commands', () => {
  test('inspects only metadata and clears the selected checkout', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    const cache = await openLocalExecutionCache({ projectRoot, cacheRoot })
    const key = {
      projectKey: cache.projectKey,
      scenarioId: 'scenario-checkout',
      scenarioRevision: 'scenario-v1',
      executionTargetProfileId: 'chromium',
      targetConfigurationFingerprint: 'target-config-v1',
      applicationRevision: 'application-v1',
      adapterKind: 'test',
      adapterCacheSchemaVersion: 'test.1',
    }
    type Payload = { operation: 'fill'; value: { variable: string } }
    const validator: ExecutionCachePayloadValidator<Payload> = {
      adapterKind: 'test',
      adapterCacheSchemaVersion: 'test.1',
      parse(payload) {
        return payload as Payload
      },
      prefixStepCount() {
        return 1
      },
    }
    const envelope: ExecutionCacheEnvelope<Payload> = {
      schemaVersion: 1,
      key,
      requiredVariables: ['password'],
      adapterPayload: {
        operation: 'fill',
        value: { variable: 'password' },
      },
    }
    await cache.write(serializeExecutionCacheEnvelope(envelope, validator), {
      sourceRunId: 'run-1',
      evaluationInferenceCount: 1,
    })
    const messages: string[] = []
    const options = {
      projectRoot,
      cacheRoot,
      report: (message: string) => messages.push(message),
    }

    expect(await runCacheCommand(['cache', 'inspect'], options)).toBe(0)
    const inspection = messages.at(-1) ?? ''
    expect(inspection).toContain('scenario-checkout')
    expect(inspection).toContain('payloadDigest')
    expect(inspection).not.toContain('adapterPayload')
    expect(inspection).not.toContain('serializedEnvelope')
    expect(inspection).not.toContain('password')

    expect(await runCacheCommand(['cache', 'clear'], options)).toBe(0)
    expect(messages.at(-1)).toBe('Cleared 1 Execution cache entry')
    expect(await cache.inspect()).toEqual([])
  })

  test('rejects unsupported cache subcommands and arguments', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const options = { projectRoot, cacheRoot: await tempRoot('pickle-cache') }

    await expect(runCacheCommand(['cache'], options)).rejects.toThrow(
      'Usage: pickle cache <inspect|clear>',
    )
    await expect(
      runCacheCommand(['cache', 'inspect', '--verbose'], options),
    ).rejects.toThrow('Usage: pickle cache inspect')
  })
})
