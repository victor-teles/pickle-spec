import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import {
  type ExecutionCacheEnvelope,
  type ExecutionCacheKey,
  type ExecutionCachePayloadValidator,
  serializeExecutionCacheEnvelope,
} from '../../../../index'

export const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

export async function tempRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `${name}-`))
  roots.push(root)
  return root
}

export type TestPayload = {
  operation: 'click'
  target: string
}

export const payloadValidator: ExecutionCachePayloadValidator<TestPayload> = {
  adapterKind: 'test',
  adapterCacheSchemaVersion: 'test.1',
  parse(payload) {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('operation' in payload) ||
      payload.operation !== 'click' ||
      !('target' in payload) ||
      typeof payload.target !== 'string'
    ) {
      return
    }
    return { operation: payload.operation, target: payload.target }
  },
  prefixStepCount() {
    return 1
  },
}

export function key(
  projectKey: string,
  scenarioRevision: string,
): ExecutionCacheKey {
  return {
    projectKey,
    scenarioId: 'scenario-checkout',
    scenarioRevision,
    executionTargetProfileId: 'chromium',
    targetConfigurationFingerprint: 'target-config-v1',
    applicationRevision: 'application-v1',
    adapterKind: 'test',
    adapterCacheSchemaVersion: 'test.1',
  }
}

export function serialized(
  projectKey: string,
  scenarioRevision: string,
  target = '#checkout',
) {
  const cacheKey = key(projectKey, scenarioRevision)
  const envelope: ExecutionCacheEnvelope<TestPayload> = {
    schemaVersion: 1,
    key: cacheKey,
    requiredVariables: [],
    adapterPayload: { operation: 'click', target },
  }
  return serializeExecutionCacheEnvelope(envelope, payloadValidator)
}

export const writeMetadata = {
  sourceRunId: 'run-1',
  evaluationModel: 'anthropic/claude-sonnet-4-6',
  evaluationInferenceCount: 2,
}
