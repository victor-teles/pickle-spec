import { Database } from 'bun:sqlite'
import type {
  ExecutionMode,
  TestResultState,
} from '../../execution/run-scenario'
import { finalScenarioAttempt } from '../../execution/run-scenario'
import type { CacheOutcome } from '../../execution-cache/execution-cache'
import type { TestRunManifest, TestRunSummary } from './test-run-store-types'

interface IndexedRun {
  id: string
  startedAt: string
  finishedAt: string | null
  sourceRunId: string | null
  suite: string | null
  executionTargetProfileIds: string
  specificationUris: string
  applicationRevision: string | null
  durationMs: number | null
  state: TestResultState
  resultCount: number
  executionModes: string
  cacheOutcomes: string
  inferenceCount: number | null
}

function testRunSummaryFrom(row: unknown): TestRunSummary {
  const indexed = row as IndexedRun
  const executionModes = JSON.parse(indexed.executionModes) as ExecutionMode[]
  const cacheOutcomes = JSON.parse(indexed.cacheOutcomes) as CacheOutcome[]
  return {
    id: indexed.id,
    startedAt: indexed.startedAt,
    ...(indexed.finishedAt ? { finishedAt: indexed.finishedAt } : {}),
    ...(indexed.sourceRunId ? { sourceRunId: indexed.sourceRunId } : {}),
    ...(indexed.suite ? { suite: indexed.suite } : {}),
    executionTargetProfileIds: JSON.parse(
      indexed.executionTargetProfileIds,
    ) as string[],
    specificationUris: JSON.parse(indexed.specificationUris) as string[],
    ...(indexed.applicationRevision
      ? { applicationRevision: indexed.applicationRevision }
      : {}),
    ...(indexed.durationMs !== null ? { durationMs: indexed.durationMs } : {}),
    state: indexed.state,
    resultCount: indexed.resultCount,
    executionModes: executionModes.length > 0 ? executionModes : undefined,
    cacheOutcomes: cacheOutcomes.length > 0 ? cacheOutcomes : undefined,
    inferenceCount: indexed.inferenceCount ?? undefined,
  }
}

type IndexColumn = { name: string }
type IndexedSchemaVersion = Record<'user_version', number>

function openIndex(path: string): Database {
  const db = new Database(path, { create: true })
  db.run(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      source_run_id TEXT,
      suite TEXT,
      execution_target_profile_ids TEXT NOT NULL DEFAULT '[]',
      specification_uris TEXT NOT NULL DEFAULT '[]',
      application_revision TEXT,
      duration_ms INTEGER,
      state TEXT NOT NULL,
      result_count INTEGER NOT NULL,
      execution_modes TEXT NOT NULL DEFAULT '[]',
      cache_outcomes TEXT NOT NULL DEFAULT '[]',
      inference_count INTEGER
    )
  `)
  const columns = new Set(
    db
      .query('PRAGMA table_info(runs)')
      .all()
      .map((row) => (row as IndexColumn).name),
  )
  const additions = [
    ['source_run_id', 'TEXT'],
    ['suite', 'TEXT'],
    ['execution_target_profile_ids', "TEXT NOT NULL DEFAULT '[]'"],
    ['specification_uris', "TEXT NOT NULL DEFAULT '[]'"],
    ['application_revision', 'TEXT'],
    ['duration_ms', 'INTEGER'],
    ['execution_modes', "TEXT NOT NULL DEFAULT '[]'"],
    ['cache_outcomes', "TEXT NOT NULL DEFAULT '[]'"],
    ['inference_count', 'INTEGER'],
  ] as const
  for (const [name, definition] of additions) {
    if (!columns.has(name))
      db.run(`ALTER TABLE runs ADD COLUMN ${name} ${definition}`)
  }
  return db
}

export function withIndex<Value>(
  path: string,
  use: (db: Database) => Value,
): Value {
  const db = openIndex(path)
  try {
    return use(db)
  } finally {
    db.close()
  }
}

export function indexVersion(path: string): number {
  return withIndex(path, (db) => {
    const row = db.query('PRAGMA user_version').get() as IndexedSchemaVersion
    return row.user_version
  })
}

function manifestInferenceCount(manifest: TestRunManifest): number | undefined {
  const counts = manifest.results.flatMap((result) => {
    const count = finalScenarioAttempt(result).inferenceCount
    return count === undefined ? [] : [count]
  })
  return counts.length > 0
    ? counts.reduce((total, count) => total + count, 0)
    : undefined
}

export function upsertRun(db: Database, manifest: TestRunManifest): void {
  const executionTargetProfileIds = [
    ...new Set(
      manifest.results.map((result) => result.executionTargetProfile.id),
    ),
  ].sort()
  const specificationUris = [
    ...new Set(manifest.results.map((result) => result.specification.uri)),
  ].sort()
  const durationMs = manifest.finishedAt
    ? Date.parse(manifest.finishedAt) - Date.parse(manifest.startedAt)
    : undefined
  const executionModes = [
    ...new Set(
      manifest.results.flatMap((result) =>
        result.attempts.flatMap((attempt) =>
          attempt.executionMode ? [attempt.executionMode] : [],
        ),
      ),
    ),
  ].sort()
  const cacheOutcomes = [
    ...new Set(
      manifest.results.flatMap((result) =>
        result.attempts.flatMap((attempt) =>
          attempt.cacheOutcome ? [attempt.cacheOutcome] : [],
        ),
      ),
    ),
  ].sort()
  const inferenceCount = manifestInferenceCount(manifest)
  db.run(
    `INSERT INTO runs (
       id, started_at, finished_at, source_run_id, suite,
       execution_target_profile_ids, specification_uris,
       application_revision, duration_ms,
       state, result_count, execution_modes, cache_outcomes, inference_count
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       started_at = excluded.started_at,
       finished_at = excluded.finished_at,
       source_run_id = excluded.source_run_id,
       suite = excluded.suite,
       execution_target_profile_ids = excluded.execution_target_profile_ids,
       specification_uris = excluded.specification_uris,
       application_revision = excluded.application_revision,
       duration_ms = excluded.duration_ms,
       state = excluded.state,
       result_count = excluded.result_count,
       execution_modes = excluded.execution_modes,
       cache_outcomes = excluded.cache_outcomes,
       inference_count = excluded.inference_count`,
    [
      manifest.id,
      manifest.startedAt,
      manifest.finishedAt ?? null,
      manifest.sourceRunId ?? null,
      manifest.suite ?? null,
      JSON.stringify(executionTargetProfileIds),
      JSON.stringify(specificationUris),
      manifest.applicationRevision ?? null,
      durationMs ?? null,
      manifest.state,
      manifest.results.length,
      JSON.stringify(executionModes),
      JSON.stringify(cacheOutcomes),
      inferenceCount ?? null,
    ],
  )
}

export function listRuns(db: Database): TestRunSummary[] {
  return db
    .query(
      `SELECT id, started_at AS startedAt, finished_at AS finishedAt,
        source_run_id AS sourceRunId, suite,
        execution_target_profile_ids AS executionTargetProfileIds,
        specification_uris AS specificationUris,
        application_revision AS applicationRevision, duration_ms AS durationMs,
        state, result_count AS resultCount,
        execution_modes AS executionModes,
        cache_outcomes AS cacheOutcomes,
        inference_count AS inferenceCount
       FROM runs ORDER BY id`,
    )
    .all()
    .map(testRunSummaryFrom)
}

export function listRunIds(db: Database): string[] {
  return db
    .query('SELECT id FROM runs ORDER BY id')
    .all()
    .map((row) => (row as Pick<IndexedRun, 'id'>).id)
}

export function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}
