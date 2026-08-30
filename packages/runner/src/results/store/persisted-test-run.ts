import { appendFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunEvent, RunEventPayload } from '../../execution/run-scenario'
import { testRunSchemaVersion } from '../../execution/run-scenario'
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
  incompatibleSchema: (version: unknown) => never
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
  incompatibleSchema: (version: unknown) => never
  serializeOperation: SerializeOperation
}

async function finalizedManifest(
  state: PersistedRunState,
): Promise<TestRunManifest | undefined> {
  if (!(await Bun.file(state.manifestPath).exists())) return undefined
  const manifest = parseTestRunManifest(
    await Bun.file(state.manifestPath).json(),
    state.incompatibleSchema,
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
  const envelope = {
    schemaVersion: testRunSchemaVersion,
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
  const versioned = { ...persisted.event, ...envelope } as RunEvent
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
    : ({ ...recordable, ...envelope } as RunEvent)
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
    schemaVersion: testRunSchemaVersion,
    id: state.id,
    startedAt: startedAtFrom(recorded, state.startedAt),
    ...(input?.finished === false
      ? {}
      : { finishedAt: state.now().toISOString() }),
    ...(state.metadata.sourceRunId
      ? { sourceRunId: state.metadata.sourceRunId }
      : {}),
    ...(state.metadata.suite ? { suite: state.metadata.suite } : {}),
    ...(state.metadata.applicationRevision
      ? { applicationRevision: state.metadata.applicationRevision }
      : {}),
    state: aggregateTestResultState(results),
    results,
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
  incompatibleSchema: (version: unknown) => never,
): Promise<RunEvent[]> {
  if (!(await Bun.file(path).exists())) return []
  const source = await Bun.file(path).text()
  return source
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseRunEvent(JSON.parse(line), incompatibleSchema))
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
