import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { IntentReview, ValidationReceipt } from '../../../index'
import {
  openLocalPlanValidationStore,
  planDigest,
  validationBasisDigest,
} from '../../../index'

const roots: string[] = []
const digest = 'a'.repeat(64)
const scope = {
  scenarioId: 'scenario-1',
  scenarioRevision: 'scenario-revision-1',
  executionTargetProfileId: 'web',
  targetConfigurationFingerprint: 'target-1',
  applicationRevision: 'app-1',
  adapterKind: 'web',
  adapterCacheSchemaVersion: '1',
}
const run = { projectKey: 'project-1', runId: 'run-1', resultDigest: digest }

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  )
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pickle-validation-'))
  roots.push(root)
  return {
    root,
    store: await openLocalPlanValidationStore({ projectRoot: root }),
  }
}

describe('local plan validation evidence', () => {
  test('keeps keyed snapshots and immutable reviews local across reopen', async () => {
    const { root, store } = await fixture()
    const snapshot = {
      formatVersion: 1 as const,
      resolvedConfiguration: { token: 'low-entropy-secret' },
      specificationSource: { revision: 'source-1' },
      selectedExamplesRowIds: [],
      applicationRevision: 'app-1',
      targetInputs: {},
      runtimeBindings: [],
      validationRequest: { resetConfirmed: true },
    }
    const first = (await store.inputSnapshotDigester()).digest(snapshot)
    expect(first).not.toBe(planDigest(snapshot))
    const review: IntentReview = {
      reviewer: { kind: 'human', id: 'operator-1' },
      candidateId: digest,
      baselineId: 'b'.repeat(64),
      scenarioRevision: scope.scenarioRevision,
      decision: 'preserves-specification',
      rationale: 'The repaired target preserves the checkout intent.',
      evidenceRunIds: [],
    }
    const written = await store.writeReview(review)
    expect(written.ok).toBe(true)
    if (!written.ok) throw new Error(written.message)
    const reopened = await openLocalPlanValidationStore({ projectRoot: root })
    expect((await reopened.inputSnapshotDigester()).digest(snapshot)).toBe(
      first,
    )
    expect(await reopened.readReview(written.value.id)).toEqual({
      ok: true,
      value: review,
    })
  })

  test('publishes only a matching passed receipt and lets a later failure supersede it', async () => {
    const { root, store } = await fixture()
    const content: Omit<ValidationReceipt, 'id'> = {
      revisionId: digest,
      key: { projectKey: run.projectKey, ...scope },
      inputSnapshotDigest: 'b'.repeat(64),
      assertionDigest: 'c'.repeat(64),
      intentReviewDigest: 'd'.repeat(64),
      validationRun: run,
      adapterValidatorVersion: '1',
      validatedAt: '2026-09-08T00:00:00.000Z',
      result: 'passed',
      inferenceCount: 0,
    }
    const basisDigest = validationBasisDigest(content)
    const passed = await store.publish({
      scope,
      basisDigest,
      run,
      outcome: 'passed',
      receipt: content,
    })
    expect(passed).toMatchObject({
      ok: true,
      value: { head: { generation: 1, outcome: 'passed' } },
    })
    if (!passed.ok || !passed.value.receipt)
      throw new Error('Expected a receipt')
    expect(
      await store.publish({
        scope,
        basisDigest,
        run,
        outcome: 'passed',
        receipt: content,
      }),
    ).toEqual(passed)
    const reopened = await openLocalPlanValidationStore({ projectRoot: root })
    expect(await reopened.readReceipt(passed.value.receipt.id)).toEqual({
      ok: true,
      value: passed.value.receipt,
    })
    expect(
      await store.publish({
        scope,
        basisDigest,
        run,
        outcome: 'cancelled',
        receipt: content,
      }),
    ).toMatchObject({ ok: false, reason: 'invalid-payload' })
    const failed = await store.publish({
      scope,
      basisDigest,
      run: { ...run, runId: 'run-2' },
      outcome: 'failed',
      receipt: null,
    })
    expect(failed).toMatchObject({
      ok: true,
      value: { head: { generation: 2, outcome: 'failed', receiptId: null } },
    })
    expect(await store.readHead(basisDigest)).toMatchObject({
      ok: true,
      value: { generation: 2, outcome: 'failed' },
    })
    const receiptPath = join(
      root,
      '.pickle',
      'runtime',
      'plans',
      'validations',
      `${passed.value.receipt.id}.json`,
    )
    const source = await readFile(receiptPath, 'utf8')
    await writeFile(
      receiptPath,
      source.replace('2026-09-08', '2026-09-09'),
      'utf8',
    )
    expect(await reopened.readReceipt(passed.value.receipt.id)).toMatchObject({
      ok: false,
      reason: 'invalid-payload',
    })
  })

  test('serializes concurrent terminal outcomes without losing a head generation', async () => {
    const { root, store } = await fixture()
    const second = await openLocalPlanValidationStore({
      projectRoot: root,
      lockWaitMs: 1000,
    })
    const basisDigest = 'e'.repeat(64)
    const results = await Promise.all([
      store.publish({
        scope,
        basisDigest,
        run,
        outcome: 'failed',
        receipt: null,
      }),
      second.publish({
        scope,
        basisDigest,
        run: { ...run, runId: 'run-2' },
        outcome: 'cancelled',
        receipt: null,
      }),
    ])
    expect(results.every((result) => result.ok)).toBe(true)
    const generations = results
      .map((result) => (result.ok ? result.value.head.generation : 0))
      .sort()
    expect(generations).toEqual([1, 2])
    expect(await store.readHead(basisDigest)).toMatchObject({
      ok: true,
      value: { generation: 2, receiptId: null },
    })
  })

  test('rejects a review whose stored bytes do not match its filename', async () => {
    const { root, store } = await fixture()
    const review: IntentReview = {
      reviewer: { kind: 'human', id: 'operator-1' },
      candidateId: digest,
      baselineId: 'b'.repeat(64),
      scenarioRevision: scope.scenarioRevision,
      decision: 'preserves-specification',
      rationale: 'Reviewed.',
      evidenceRunIds: [],
    }
    const written = await store.writeReview(review)
    if (!written.ok) throw new Error(written.message)
    const path = join(
      root,
      '.pickle',
      'runtime',
      'plans',
      'reviews',
      `${written.value.id}.json`,
    )
    const source = await readFile(path, 'utf8')
    await writeFile(path, source.replace('Reviewed.', 'Changed.'), 'utf8')
    expect(await store.readReview(written.value.id)).toMatchObject({
      ok: false,
      reason: 'invalid-payload',
    })
  })
})
