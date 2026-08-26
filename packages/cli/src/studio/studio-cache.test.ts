import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ExecutionCacheEnvelope,
  type ExecutionCachePayloadValidator,
  openLocalExecutionCache,
  serializeExecutionCacheEnvelope,
} from '@pickle-spec/runner'
import { createStudioExecutionCacheGateway } from './studio-cache'

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

test('Studio inspects metadata and clears only its checkout Execution cache', async () => {
  const projectRoot = await tempRoot('pickle-project')
  const cacheRoot = await tempRoot('pickle-cache')
  const cache = await openLocalExecutionCache({ projectRoot, cacheRoot })
  type Payload = { operation: 'fill'; value: { variable: string } }
  const validator: ExecutionCachePayloadValidator<Payload> = {
    adapterKind: 'test',
    adapterCacheSchemaVersion: 'test.1',
    parse(payload) {
      return payload as Payload
    },
  }
  const envelope: ExecutionCacheEnvelope<Payload> = {
    schemaVersion: 1,
    key: {
      projectKey: cache.projectKey,
      scenarioId: 'scenario-checkout',
      scenarioRevision: 'scenario-v1',
      executionTargetProfileId: 'chromium',
      targetConfigurationFingerprint: 'target-config-v1',
      applicationRevision: 'application-v1',
      adapterKind: 'test',
      adapterCacheSchemaVersion: 'test.1',
    },
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
  const gateway = createStudioExecutionCacheGateway(
    projectRoot,
    async () => ({ maxBytes: 4_096 }),
    cacheRoot,
  )

  const inspection = await gateway.inspect()
  expect(inspection).toMatchObject({
    projectKey: cache.projectKey,
    maxBytes: 4_096,
    entries: [
      {
        key: {
          scenarioId: 'scenario-checkout',
          scenarioRevision: 'scenario-v1',
          applicationRevision: 'application-v1',
        },
        hitCount: 0,
      },
    ],
  })
  expect(JSON.stringify(inspection)).not.toContain('password')
  expect(JSON.stringify(inspection)).not.toContain('adapterPayload')

  expect(await gateway.clear()).toEqual({ clearedEntries: 1 })
  expect((await gateway.inspect()).entries).toEqual([])
})
