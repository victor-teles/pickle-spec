import { appendFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunEvent, RunEventPayload } from '../../execution/run-scenario'
import {
  authoredPlanRunSchemaVersion,
  testRunSchemaVersion,
} from '../../execution/run-scenario'
import { recordableRunEventPayloadData } from '../public-results'
import { parseRunEvent, parseTestRunManifest } from '../test-run-schema'
import {
  type EvidencePersistencePolicy,
  persistEventArtifacts,
  shouldPersistEventEvidence,
} from './test-run-evidence'
import {
  aggregateTestResultState,
  materializeTestResults,
  startedAtFrom,
} from './test-run-materialization'
import type {
  CreateTestRunOptions,
  PersistedTestRun,
  TestRunManifest,
} from './test-run-store-types'

type SerializeOperation = <Value>(
  operation: () => Promise<Value>,
) => Promise<Value>

interface PersistedRunState {
  id: string
  startedAt: string
  now: () => Date
  evidencePersistenceFor: (profileId: string) => EvidencePersistencePolicy
  onMaterialize: (manifest: TestRunManifest) => Promise<void>
  metadata: CreateTestRunOptions
  incompatibleSchema: (version: string) => never
  eventsPath: string
  manifestPath: string
  artifactsDirectory: string
}

export interface PersistedTestRunOptions {
  id: string
  directory: string
  startedAt: string
  now: () => Date
  evidencePersistenceFor: (profileId: string) => EvidencePersistencePolicy
  onMaterialize: (manifest: TestRunManifest) => Promise<void>
  metadata: CreateTestRunOptions
  incompatibleSchema: (version: string) => never
  serializeOperation: SerializeOperation
}

async function finalizedManifest(
  state: PersistedRunState,
): Promise<TestRunManifest | undefined> {
  if (!(await Bun.file(state.manifestPath).exists())) return undefined
  const manifest = parseTestRunManifest(state.incompatibleSchema)(
    await Bun.file(state.manifestPath).json(),
  )
  return manifest.finishedAt ? manifest : undefined
}

async function appendPersistedEvent(
  state: PersistedRunState,
  event: RunEvent | RunEventPayload,
): Promise<RunEvent> {
  if (await finalizedManifest(state)) {
    throw new Error(`Test run "${state.id}" is finalized and cannot be changed`)
  }
  const current = await readEvents(state.eventsPath, state.incompatibleSchema)
  const recordable = recordableRunEventPayloadData(eventPayload(event))
  const profileId =
    'scope' in recordable ? recordable.scope.executionTargetProfileId : ''
  const policy = state.evidencePersistenceFor(profileId)
  const carriesPlanUse =
    ('planUse' in recordable && recordable.planUse !== undefined) ||
    (recordable.type === 'scenario-finished' &&
      recordable.attempt.planUse !== undefined)
  let schemaVersion =
    'schemaVersion' in event ? event.schemaVersion : testRunSchemaVersion
  if (carriesPlanUse) schemaVersion = authoredPlanRunSchemaVersion
  const envelope = {
    schemaVersion,
    sequence: current.length + 1,
    occurredAt:
      'occurredAt' in event ? event.occurredAt : state.now().toISOString(),
  } as const
  const persisted = await persistEventArtifacts(
    recordable,
    current,
    policy,
    state.artifactsDirectory,
    envelope.sequence,
  )
  const versioned = { ...persisted.event, ...envelope } satisfies RunEvent
  try {
    await appendFile(state.eventsPath, `${JSON.stringify(versioned)}\n`)
  } catch (error) {
    await Promise.all(
      persisted.publishedPaths.map((path) => rm(path, { force: true })),
    )
    throw error
  }
  return shouldPersistEventEvidence(recordable, policy)
    ? versioned
    : { ...recordable, ...envelope }
}

async function materializePersistedRun(
  state: PersistedRunState,
  input?: { finished?: boolean },
): Promise<TestRunManifest> {
  const finalized = await finalizedManifest(state)
  if (finalized) return finalized
  const recorded = await readEvents(state.eventsPath, state.incompatibleSchema)
  const results = materializeTestResults(recorded)
  const manifest: TestRunManifest = {
    schemaVersion: recorded.some(
      (event) => event.schemaVersion === authoredPlanRunSchemaVersion,
    )
      ? authoredPlanRunSchemaVersion
      : testRunSchemaVersion,
    id: state.id,
    startedAt: startedAtFrom(recorded, state.startedAt),
    state: aggregateTestResultState(results),
    results,
  }
  if (!(input?.finished === false)) {
    manifest.finishedAt = state.now().toISOString()
  }
  if (state.metadata.sourceRunId) {
    manifest.sourceRunId = state.metadata.sourceRunId
  }
  if (state.metadata.suite) {
    manifest.suite = state.metadata.suite
  }
  if (state.metadata.applicationRevision) {
    manifest.applicationRevision = state.metadata.applicationRevision
  }
  await Bun.write(state.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  await state.onMaterialize(manifest)
  return manifest
}

export function createPersistedTestRun(
  options: PersistedTestRunOptions,
): PersistedTestRun {
  const state: PersistedRunState = {
    id: options.id,
    startedAt: options.startedAt,
    now: options.now,
    evidencePersistenceFor: options.evidencePersistenceFor,
    onMaterialize: options.onMaterialize,
    metadata: options.metadata,
    incompatibleSchema: options.incompatibleSchema,
    eventsPath: join(options.directory, 'events.ndjson'),
    manifestPath: join(options.directory, 'manifest.json'),
    artifactsDirectory: join(options.directory, 'artifacts'),
  }

  return {
    id: options.id,
    append(event) {
      return options.serializeOperation(() =>
        appendPersistedEvent(state, event),
      )
    },
    events() {
      return options.serializeOperation(() =>
        readEvents(state.eventsPath, options.incompatibleSchema),
      )
    },
    materialize(input) {
      return options.serializeOperation(() =>
        materializePersistedRun(state, input),
      )
    },
  }
}

export async function readEvents(
  path: string,
  incompatibleSchema: (version: string) => never,
): Promise<RunEvent[]> {
  if (!(await Bun.file(path).exists())) return []
  const source = await Bun.file(path).text()
  return source
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseRunEvent(incompatibleSchema)(JSON.parse(line)))
}

function eventPayload(event: RunEvent | RunEventPayload): RunEventPayload {
  if ('schemaVersion' in event) {
    const {
      schemaVersion: _schemaVersion,
      sequence: _sequence,
      occurredAt: _occurredAt,
      ...payload
    } = event
    return payload
  }
  return event
}
