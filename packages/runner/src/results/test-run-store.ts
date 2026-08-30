import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RunEventPayload } from '../execution/run-scenario'
import { resolveLocalProjectStorage } from '../storage/local-project-storage'
import { createPersistedTestRun, readEvents } from './store/persisted-test-run'
import type { EvidencePersistencePolicy } from './store/test-run-evidence'
import {
  indexVersion,
  listRunIds,
  listRuns,
  sameStrings,
  upsertRun,
  withIndex,
} from './store/test-run-index'
import { startedAtFrom } from './store/test-run-materialization'
import {
  applyRunRetention,
  inspectTestRunStorage,
  updatePinnedRun,
} from './store/test-run-storage-management'
import type {
  CreateTestRunOptions,
  PersistedTestRun,
  RetentionPolicy,
  RetentionResult,
  TestRunManifest,
  TestRunStorageInspection,
  TestRunStore,
  TestRunStoreOptions,
  TestRunSummary,
} from './store/test-run-store-types'
import { validateTestRunId } from './test-run-id'
import { parseTestRunManifest } from './test-run-schema'

export { slug } from './store/test-run-artifacts'
export type {
  ArtifactCapturePolicy,
  EvidencePersistencePolicy,
} from './store/test-run-evidence'
export {
  aggregateTestResultState,
  materializeTestResults,
} from './store/test-run-materialization'
export type {
  CreateTestRunOptions,
  PersistedTestRun,
  RetentionPolicy,
  RetentionResult,
  TestRunManifest,
  TestRunStorageInspection,
  TestRunStore,
  TestRunStoreOptions,
  TestRunSummary,
} from './store/test-run-store-types'

const indexSchemaVersion = 5

export const defaultRetention: Readonly<RetentionPolicy> = {}
export const defaultRunStorageWarningBytes = 5 * 1024 * 1024 * 1024

function runStartedEvent(
  id: string,
  startedAt: string,
  options: CreateTestRunOptions,
): RunEventPayload {
  return {
    type: 'run-started',
    run: {
      id,
      startedAt,
      ...(options.sourceRunId ? { sourceRunId: options.sourceRunId } : {}),
      ...(options.suite ? { suite: options.suite } : {}),
      ...(options.applicationRevision
        ? { applicationRevision: options.applicationRevision }
        : {}),
      ...(options.evidencePersistence
        ? { evidencePersistence: options.evidencePersistence }
        : {}),
    },
  }
}

type NodeError = Error & { code?: string }

class LocalTestRunStore implements TestRunStore {
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly evidencePersistence: EvidencePersistencePolicy
  private readonly evidencePersistenceByProfile: Readonly<
    Record<string, EvidencePersistencePolicy>
  >
  private readonly projectDirectory: string
  private readonly runsDirectory: string
  private readonly indexPath: string
  private readonly runPinsPath: string
  private readonly runOperationQueues = new Map<string, Promise<void>>()
  private managementOperationQueue = Promise.resolve()

  constructor(options: TestRunStoreOptions) {
    this.createId = options.createId ?? (() => crypto.randomUUID())
    this.now = options.now ?? (() => new Date())
    this.evidencePersistence =
      options.evidencePersistence ?? options.artifactCapture ?? 'on-failure'
    this.evidencePersistenceByProfile =
      options.evidencePersistenceByProfile ?? {}
    const storage = resolveLocalProjectStorage(options.root, options.pickleHome)
    this.projectDirectory = storage.projectDirectory
    this.runsDirectory = storage.runsDirectory
    this.indexPath = storage.runIndexPath
    this.runPinsPath = storage.runPinsPath
  }

  private incompatibleSchema = (version: unknown): never => {
    throw new Error(
      `Test run storage schema version ${String(version)} is unsupported. ` +
        `Pickle did not modify it. Remove the runs directory manually and retry: ${this.runsDirectory}`,
    )
  }

  private serializeRunOperation<Value>(
    id: string,
    operation: () => Promise<Value>,
  ): Promise<Value> {
    const pending = this.runOperationQueues.get(id) ?? Promise.resolve()
    const result = pending.then(operation)
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    this.runOperationQueues.set(id, tail)
    void tail.then(() => {
      if (this.runOperationQueues.get(id) === tail)
        this.runOperationQueues.delete(id)
    })
    return result
  }

  private serializeManagementOperation<Value>(
    operation: () => Promise<Value>,
  ): Promise<Value> {
    const result = this.managementOperationQueue.then(operation)
    this.managementOperationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async updatePin(id: string, pinned: boolean): Promise<void> {
    await this.serializeManagementOperation(async () => {
      await updatePinnedRun(
        {
          projectDirectory: this.projectDirectory,
          runsDirectory: this.runsDirectory,
          indexPath: this.indexPath,
          runPinsPath: this.runPinsPath,
        },
        id,
        pinned,
      )
    })
  }

  private async upsertManifest(manifest: TestRunManifest): Promise<void> {
    await mkdir(this.projectDirectory, { recursive: true })
    withIndex(this.indexPath, (db) => upsertRun(db, manifest))
  }

  private persistedRunFor(
    id: string,
    startedAt: string,
    metadata: CreateTestRunOptions = {},
  ): PersistedTestRun {
    return createPersistedTestRun({
      id,
      directory: join(this.runsDirectory, id),
      startedAt,
      now: this.now,
      evidencePersistenceFor: (profileId) =>
        metadata.evidencePersistence ??
        this.evidencePersistenceByProfile[profileId] ??
        this.evidencePersistence,
      onMaterialize: (manifest) => this.upsertManifest(manifest),
      metadata,
      incompatibleSchema: this.incompatibleSchema,
      serializeOperation: (operation) =>
        this.serializeRunOperation(id, operation),
    })
  }

  async open(id: string): Promise<PersistedTestRun> {
    validateTestRunId(id)
    const events = await this.serializeRunOperation(id, () =>
      readEvents(
        join(this.runsDirectory, id, 'events.ndjson'),
        this.incompatibleSchema,
      ),
    )
    const started = events.find((event) => event.type === 'run-started')
    const metadata =
      started?.type === 'run-started'
        ? {
            sourceRunId: started.run.sourceRunId,
            suite: started.run.suite,
            applicationRevision: started.run.applicationRevision,
            evidencePersistence: started.run.evidencePersistence,
          }
        : {}
    return this.persistedRunFor(
      id,
      startedAtFrom(events, this.now().toISOString()),
      metadata,
    )
  }

  private async manifestFor(id: string): Promise<TestRunManifest> {
    const manifestPath = join(this.runsDirectory, id, 'manifest.json')
    if (await Bun.file(manifestPath).exists()) {
      return parseTestRunManifest(
        await Bun.file(manifestPath).json(),
        this.incompatibleSchema,
      )
    }
    return (await this.open(id)).materialize({ finished: false })
  }

  private async loadManifests(): Promise<TestRunManifest[]> {
    const manifests: TestRunManifest[] = []
    if (!(await pathExists(this.runsDirectory))) return manifests
    const files = new Bun.Glob('*/events.ndjson').scan({
      cwd: this.runsDirectory,
      onlyFiles: true,
    })
    for await (const relativePath of files) {
      const id = dirname(relativePath)
      validateTestRunId(id)
      const manifest = await this.manifestFor(id)
      if (manifest.id !== id) {
        throw new Error(
          `Test run manifest identifier "${manifest.id}" does not match "${id}"`,
        )
      }
      manifests.push(manifest)
    }
    return manifests
  }

  private async rebuild(providedManifests?: TestRunManifest[]): Promise<void> {
    const manifests = providedManifests ?? (await this.loadManifests())
    await mkdir(this.projectDirectory, { recursive: true })
    withIndex(this.indexPath, (db) => {
      db.run('DELETE FROM runs')
      for (const manifest of manifests) upsertRun(db, manifest)
      db.run(`PRAGMA user_version = ${indexSchemaVersion}`)
    })
  }

  private async applyRetentionPolicy(
    policy: RetentionPolicy,
  ): Promise<RetentionResult> {
    return applyRunRetention(
      {
        projectDirectory: this.projectDirectory,
        runsDirectory: this.runsDirectory,
        indexPath: this.indexPath,
        runPinsPath: this.runPinsPath,
      },
      policy,
      this.now(),
      () => this.loadManifests(),
    )
  }

  async create(metadata: CreateTestRunOptions = {}): Promise<PersistedTestRun> {
    await this.loadManifests()
    const id = this.createId()
    validateTestRunId(id)
    const startedAt = this.now().toISOString()
    await mkdir(this.runsDirectory, { recursive: true })
    const runDirectory = join(this.runsDirectory, id)
    try {
      await mkdir(runDirectory)
    } catch (error) {
      if (isAlreadyExists(error)) {
        throw new Error(`Test run "${id}" already exists`)
      }
      throw error
    }
    const run = this.persistedRunFor(id, startedAt, metadata)
    try {
      await run.append(runStartedEvent(id, startedAt, metadata))
      return run
    } catch (error) {
      await rm(runDirectory, { recursive: true, force: true })
      throw error
    }
  }

  async list(): Promise<TestRunSummary[]> {
    const manifests = await this.loadManifests()
    const storedIds = manifests.map((manifest) => manifest.id).sort()
    const indexedIds = (await Bun.file(this.indexPath).exists())
      ? withIndex(this.indexPath, listRunIds)
      : []
    if (
      !(await Bun.file(this.indexPath).exists()) ||
      indexVersion(this.indexPath) < indexSchemaVersion ||
      !sameStrings(storedIds, indexedIds)
    ) {
      await this.rebuild(manifests)
    }
    return withIndex(this.indexPath, listRuns)
  }

  rebuildIndex(): Promise<void> {
    return this.rebuild()
  }

  async inspectStorage(): Promise<TestRunStorageInspection> {
    return inspectTestRunStorage(
      {
        projectDirectory: this.projectDirectory,
        runsDirectory: this.runsDirectory,
        indexPath: this.indexPath,
        runPinsPath: this.runPinsPath,
      },
      defaultRunStorageWarningBytes,
    )
  }

  pin(id: string): Promise<void> {
    return this.updatePin(id, true)
  }

  unpin(id: string): Promise<void> {
    return this.updatePin(id, false)
  }

  applyRetention(policy: RetentionPolicy = {}): Promise<RetentionResult> {
    return this.serializeManagementOperation(() =>
      this.applyRetentionPolicy(policy),
    )
  }
}

export function openTestRunStore(options: TestRunStoreOptions): TestRunStore {
  return new LocalTestRunStore(options)
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && (error as NodeError).code === 'EEXIST'
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
