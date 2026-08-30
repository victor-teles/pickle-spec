import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Scenario, Specification } from '@pickle-spec/spec'
import { afterEach } from 'vitest'
import { z } from 'zod'
import type {
  ExecutionCacheAdapter,
  ExecutionCacheStore,
  ExecutionTargetAdapter,
} from '../../../../index'
import { openLocalExecutionCache, type runScenario } from '../../../../index'

export type RunScenarioInput = Parameters<typeof runScenario>[0]

export type CacheRunInput = RunScenarioInput & {
  executionCache: NonNullable<RunScenarioInput['executionCache']>
}

export const specification: Specification = {
  name: 'Checkout',
  source: { uri: 'features/checkout.feature', language: 'en' },
  tags: [],
  scenarios: [],
}

export const scenario: Scenario = {
  id: 'scncheckout000000',
  name: 'Complete checkout',
  tags: [],
  steps: [
    { keyword: 'When', text: 'the order is confirmed', type: 'action' },
    { keyword: 'Then', text: 'the receipt is shown', type: 'outcome' },
  ],
}

export const payloadSchema = z.strictObject({
  operations: z.array(z.string()),
})

export type Payload = z.infer<typeof payloadSchema>

export const completeOperations = ['confirm', 'assert-receipt']

export function denseCompiledHead(
  compiled: Array<string | undefined>,
): string[] {
  const operations = []
  for (const operation of compiled) {
    if (operation === undefined) break
    operations.push(operation)
  }
  return operations
}

export function prefixRepresentation(operations: string[]) {
  return operations.length > 0
    ? {
        cacheable: true as const,
        adapterPayload: { operations },
        requiredVariables: [] as string[],
      }
    : {
        cacheable: false as const,
        reason: 'non-deterministic-action' as const,
      }
}

export const executionCache: ExecutionCacheAdapter<Payload> = {
  adapterKind: 'deterministic-test',
  adapterCacheSchemaVersion: '1',
  targetConfigurationFingerprint: 'target-config-1',
  parse(payload) {
    return payloadSchema.safeParse(payload).data
  },
  prefixStepCount(payload) {
    return payload.operations.length
  },
}

export const cacheRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    cacheRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  )
})

export interface LocalStoreOptions {
  waitTimeoutMs?: number
  ttlMs?: number
  heartbeatMs?: number
  maxBytes?: number
}

export async function localStore(options: LocalStoreOptions = {}) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'pickle-project-'))
  const cacheRoot = await mkdtemp(join(tmpdir(), 'pickle-cache-'))
  cacheRoots.push(projectRoot, cacheRoot)
  return openLocalExecutionCache({
    projectRoot,
    cacheRoot,
    maxBytes: options.maxBytes,
    leaseTiming: {
      ttlMs: options.ttlMs ?? 30_000,
      heartbeatMs: options.heartbeatMs ?? 10_000,
      waitTimeoutMs: options.waitTimeoutMs ?? 30_000,
      minPollMs: 1,
      maxPollMs: 2,
    },
  })
}

export function observeLeaseWait(
  cache: Awaited<ReturnType<typeof localStore>>,
): {
  store: ExecutionCacheStore
  waiting: Promise<void>
} {
  let waiterStarted: (() => void) | undefined
  const waiting = new Promise<void>((resolve) => {
    waiterStarted = resolve
  })
  return {
    waiting,
    store: {
      ...cache,
      coordination: {
        ...cache.coordination,
        async wait(...args) {
          waiterStarted?.()
          return cache.coordination.wait(...args)
        },
      },
    },
  }
}

export function memoryStore() {
  const entries = new Map<string, string>()
  const writes: string[] = []
  const store: ExecutionCacheStore = {
    async read(key) {
      return entries.get(JSON.stringify(key))
    },
    async write(serialized) {
      entries.set(JSON.stringify(serialized.key), serialized.source)
      writes.push(serialized.source)
      return { stored: true, evictedEntries: 0 }
    },
    async delete(key) {
      entries.delete(JSON.stringify(key))
    },
    async inspect() {
      return []
    },
    async clear() {
      entries.clear()
    },
  }
  return { entries, store, writes }
}

export interface CacheRunFixtureOptions {
  adapter: ExecutionTargetAdapter
  store: ExecutionCacheStore
  applicationRevision?: string | null
  cachePolicy?: RunScenarioInput['cachePolicy']
  retry?: RunScenarioInput['retry']
  selectedScenario?: Scenario
  selectedSpecification?: Specification
  sourceRunId?: string
  projectKey?: string
}

export function cacheRunInput({
  adapter,
  store,
  applicationRevision = 'app-1',
  cachePolicy,
  retry,
  selectedScenario = scenario,
  selectedSpecification = specification,
  sourceRunId = 'run-1',
  projectKey = 'project-1',
}: CacheRunFixtureOptions): CacheRunInput {
  return {
    specification: selectedSpecification,
    scenario: selectedScenario,
    executionTargetProfile: { id: 'test' },
    adapter,
    applicationRevision: applicationRevision ?? undefined,
    cachePolicy,
    retry,
    executionCache: {
      store,
      projectKey,
      sourceRunId,
    },
  }
}
