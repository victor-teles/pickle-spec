import type {
  ExecutionCacheStore,
  SerializedExecutionCacheEnvelope,
} from '@pickle-spec/runner'
import type {
  WebAutomation,
  WebAutomationFactory,
} from '../adapter/automation/web-automation'

export function memoryStore() {
  const entries = new Map<string, string>()
  const writes: string[] = []
  const store: ExecutionCacheStore = {
    async read(key) {
      return entries.get(JSON.stringify(key))
    },
    async write(serialized: SerializedExecutionCacheEnvelope) {
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
  return { store, writes }
}

export function factoryFor(automation: WebAutomation): WebAutomationFactory {
  return {
    async launch() {
      return {
        async openContext() {
          return automation
        },
        async close() {},
      }
    },
  }
}
