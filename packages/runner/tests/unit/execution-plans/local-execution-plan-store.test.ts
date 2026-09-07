import { randomUUID } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { PlanRevisionContent, PlanScope } from '../../../index'
import {
  openLocalExecutionCache,
  openLocalExecutionPlanStore,
  planSlotId,
  serializePlanDocument,
} from '../../../index'
import { serialized, writeMetadata } from '../execution-cache/local/fixtures'

const digest = (character: string) => character.repeat(64)

const scope: PlanScope = {
  scenarioId: 'checkout',
  scenarioRevision: 'scenario-v1',
  executionTargetProfileId: 'local-web',
  targetConfigurationFingerprint: 'chrome-v1',
  applicationRevision: 'app-v1',
  adapterKind: 'web',
  adapterCacheSchemaVersion: '1',
}

function revisionContent(
  createdAt: string,
  selector: string,
): PlanRevisionContent {
  return {
    formatVersion: 1,
    scope,
    origin: { kind: 'cache-capture', payloadDigest: digest('a') },
    author: { kind: 'human', id: 'victor' },
    createdAt,
    requiredVariables: ['account_id'],
    steps: [{ scenarioRevision: 'scenario-v1', index: 0 }],
    adapterPayload: { instructions: [{ method: 'click', selector }] },
    assertionBaselineRevisionId: null,
  }
}

async function projectRoot() {
  const root = await mkdtemp(join(tmpdir(), 'pickle-plan-store-'))
  roots.push(root)
  return root
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('local Execution Plan store', () => {
  test('opens and inspects without creating project state', async () => {
    const root = await projectRoot()
    const store = await openLocalExecutionPlanStore({ projectRoot: root })

    expect(await store.inspect(scope)).toEqual({
      ok: true,
      value: {
        selection: { state: 'absent' },
        revisions: [],
        unavailableRevisions: [],
      },
    })
    expect(await Bun.file(join(root, '.pickle')).exists()).toBe(false)
  })

  test('persists immutable revisions idempotently with deterministic restart history', async () => {
    const root = await projectRoot()
    const store = await openLocalExecutionPlanStore({ projectRoot: root })
    const older = await store.createRevision(
      revisionContent('2026-09-05T10:00:00.000Z', '#pay'),
    )
    const newer = await store.createRevision(
      revisionContent('2026-09-06T10:00:00.000Z', '#confirm'),
    )
    const repeated = await store.createRevision(
      revisionContent('2026-09-05T10:00:00.000Z', '#pay'),
    )

    expect(older.ok).toBe(true)
    expect(newer.ok).toBe(true)
    expect(repeated).toEqual(older)

    const reopened = await openLocalExecutionPlanStore({ projectRoot: root })
    const history = await reopened.inspect(scope)
    expect(history.ok).toBe(true)
    if (!history.ok || !older.ok || !newer.ok) return
    expect(history.value.revisions.map((revision) => revision.id)).toEqual([
      newer.value.id,
      older.value.id,
    ])
  })

  test('serializes selection writers and rejects a stale full-digest compare-and-swap', async () => {
    const root = await projectRoot()
    const firstStore = await openLocalExecutionPlanStore({ projectRoot: root })
    const secondStore = await openLocalExecutionPlanStore({ projectRoot: root })
    const revision = await firstStore.createRevision(
      revisionContent('2026-09-06T10:00:00.000Z', '#pay'),
    )
    expect(revision.ok).toBe(true)
    if (!revision.ok) return

    const input = {
      scope,
      active: { revisionId: revision.value.id },
      expectedSelectionDigest: null,
      actor: { kind: 'human' as const, id: 'victor' },
      reason: 'activate' as const,
    }
    const results = await Promise.all([
      firstStore.writeSelection(input),
      secondStore.writeSelection(input),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(
      results.filter((result) => !result.ok).map((result) => result.reason),
    ).toEqual(['write-conflict'])

    const history = await firstStore.inspect(scope)
    expect(history.ok && history.value.selection.state).toBe('available')
  })

  test('keeps authored revisions after disposable cache clear', async () => {
    const root = await projectRoot()
    const cacheRoot = await projectRoot()
    const plans = await openLocalExecutionPlanStore({ projectRoot: root })
    const revision = await plans.createRevision(
      revisionContent('2026-09-06T10:00:00.000Z', '#pay'),
    )
    expect(revision.ok).toBe(true)
    if (!revision.ok) return
    const selection = await plans.writeSelection({
      scope,
      active: { revisionId: revision.value.id },
      expectedSelectionDigest: null,
      actor: { kind: 'human', id: 'victor' },
      reason: 'activate',
    })
    expect(selection.ok).toBe(true)

    const cache = await openLocalExecutionCache({
      projectRoot: root,
      cacheRoot,
    })
    await cache.clear()

    const history = await plans.inspect(scope)
    expect(history.ok).toBe(true)
    if (!history.ok) return
    expect(history.value.revisions.map((item) => item.id)).toEqual([
      revision.value.id,
    ])
    expect(history.value.selection.state).toBe('available')
  })

  test('keeps authored revisions after disposable cache eviction', async () => {
    const root = await projectRoot()
    const cacheRoot = await projectRoot()
    const plans = await openLocalExecutionPlanStore({ projectRoot: root })
    const revision = await plans.createRevision(
      revisionContent('2026-09-06T10:00:00.000Z', '#pay'),
    )
    expect(revision.ok).toBe(true)
    if (!revision.ok) return

    const probe = await openLocalExecutionCache({
      projectRoot: root,
      cacheRoot,
    })
    const first = serialized(probe.projectKey, 'cache-v1')
    const cache = await openLocalExecutionCache({
      projectRoot: root,
      cacheRoot,
      maxBytes: Buffer.byteLength(first.source, 'utf8') + 1,
    })
    const second = serialized(cache.projectKey, 'cache-v2')
    await cache.write(first, writeMetadata)
    await cache.write(second, writeMetadata)

    const history = await plans.inspect(scope)
    expect(history.ok).toBe(true)
    if (!history.ok) return
    expect(history.value.revisions.map((item) => item.id)).toEqual([
      revision.value.id,
    ])
  })

  test('keeps valid history visible beside malformed and interrupted files', async () => {
    const root = await projectRoot()
    const store = await openLocalExecutionPlanStore({ projectRoot: root })
    const revision = await store.createRevision(
      revisionContent('2026-09-06T10:00:00.000Z', '#pay'),
    )
    expect(revision.ok).toBe(true)
    if (!revision.ok) return
    const revisionsDirectory = join(root, '.pickle', 'plans', 'revisions')
    const malformedId = digest('b')
    const malformedPath = join(revisionsDirectory, `${malformedId}.json`)
    const malformed = '{"formatVersion":1,"formatVersion":1}'
    await writeFile(malformedPath, malformed)
    await writeFile(join(revisionsDirectory, '.interrupted.tmp'), '{')

    const history = await store.inspect(scope)
    expect(history.ok).toBe(true)
    if (!history.ok) return
    expect(history.value.revisions.map((item) => item.id)).toEqual([
      revision.value.id,
    ])
    expect(history.value.unavailableRevisions).toMatchObject([
      { revisionId: malformedId, reason: 'invalid-payload' },
    ])
    expect(await readFile(malformedPath, 'utf8')).toBe(malformed)
  })

  test('reports a symlinked revision without hiding valid history', async () => {
    const root = await projectRoot()
    const outside = await projectRoot()
    const store = await openLocalExecutionPlanStore({ projectRoot: root })
    const revision = await store.createRevision(
      revisionContent('2026-09-06T10:00:00.000Z', '#pay'),
    )
    expect(revision.ok).toBe(true)
    if (!revision.ok) return

    const revisionsDirectory = join(root, '.pickle', 'plans', 'revisions')
    const symlinkId = digest('c')
    const outsideFile = join(outside, 'revision.json')
    await writeFile(outsideFile, '{}')
    await symlink(outsideFile, join(revisionsDirectory, `${symlinkId}.json`))

    const history = await store.inspect(scope)
    expect(history.ok).toBe(true)
    if (!history.ok) return
    expect(history.value.revisions.map((item) => item.id)).toEqual([
      revision.value.id,
    ])
    expect(history.value.unavailableRevisions).toContainEqual({
      revisionId: symlinkId,
      reason: 'invalid-payload',
      message: expect.stringContaining('not a regular file'),
    })
  })

  test('rejects traversal IDs and symlinked managed roots', async () => {
    const root = await projectRoot()
    const outside = await projectRoot()
    const store = await openLocalExecutionPlanStore({ projectRoot: root })
    expect(await store.readRevision('../../outside')).toMatchObject({
      ok: false,
      reason: 'invalid-payload',
    })

    await symlink(outside, join(root, '.pickle'))
    expect(
      await store.createRevision(
        revisionContent('2026-09-06T10:00:00.000Z', '#pay'),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-payload' })
    expect(await Bun.file(join(outside, 'plans')).exists()).toBe(false)
  })

  test('does not take over a live or malformed lock and reclaims a proven dead lock', async () => {
    const root = await projectRoot()
    const store = await openLocalExecutionPlanStore({
      projectRoot: root,
      lockWaitMs: 0,
    })
    const revision = await store.createRevision(
      revisionContent('2026-09-06T10:00:00.000Z', '#pay'),
    )
    expect(revision.ok).toBe(true)
    if (!revision.ok) return
    const lockDirectory = join(root, '.pickle', 'runtime', 'plans')
    const lockPath = join(lockDirectory, `${planSlotId(scope)}.lock`)
    await mkdir(lockDirectory, { recursive: true })
    await writeFile(
      lockPath,
      serializePlanDocument({
        formatVersion: 1,
        ownerToken: randomUUID(),
        hostname: hostname(),
        pid: process.pid,
      }),
    )
    const input = {
      scope,
      active: { revisionId: revision.value.id },
      expectedSelectionDigest: null,
      actor: { kind: 'human' as const, id: 'victor' },
      reason: 'activate' as const,
    }
    expect(await store.writeSelection(input)).toMatchObject({
      ok: false,
      reason: 'write-conflict',
    })

    await writeFile(lockPath, '{')
    expect(await store.writeSelection(input)).toMatchObject({
      ok: false,
      reason: 'write-conflict',
    })

    await writeFile(
      lockPath,
      serializePlanDocument({
        formatVersion: 1,
        ownerToken: randomUUID(),
        hostname: hostname(),
        pid: 999_999,
      }),
    )
    expect(await store.writeSelection(input)).toMatchObject({ ok: true })
  })
})
