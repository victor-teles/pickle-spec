import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createFilePlanStore,
  type ExecutionPlan,
  type ExecutionPlanStore,
  planApplies,
} from '../index'

const applicable: ExecutionPlan = {
  schemaVersion: 1,
  scenarioId: 'scnbbbbbbbbbbbb',
  scenarioRevision: 'rev-a',
  executionTargetProfileId: 'web',
  planFormatVersion: 'web.1',
  applicationRevision: 'app-1',
  steps: [
    {
      resolvedActions: [
        { description: 'Fill the search field', replay: { selector: '#q' } },
        { description: 'Submit the search', replay: { selector: '#go' } },
      ],
    },
  ],
}

describe('planApplies', () => {
  test('requires Scenario revision, target profile, plan-format version, and application revision', () => {
    expect(
      planApplies(applicable, {
        scenarioId: 'scnbbbbbbbbbbbb',
        scenarioRevision: 'rev-a',
        executionTargetProfileId: 'web',
        planFormatVersion: 'web.1',
        applicationRevision: 'app-1',
      }),
    ).toBe(true)
    expect(
      planApplies(applicable, {
        scenarioId: 'scnbbbbbbbbbbbb',
        scenarioRevision: 'rev-b',
        executionTargetProfileId: 'web',
        planFormatVersion: 'web.1',
        applicationRevision: 'app-1',
      }),
    ).toBe(false)
    expect(
      planApplies(applicable, {
        scenarioId: 'scnbbbbbbbbbbbb',
        scenarioRevision: 'rev-a',
        executionTargetProfileId: 'mobile',
        planFormatVersion: 'web.1',
        applicationRevision: 'app-1',
      }),
    ).toBe(false)
    expect(
      planApplies(applicable, {
        scenarioId: 'scnbbbbbbbbbbbb',
        scenarioRevision: 'rev-a',
        executionTargetProfileId: 'web',
        planFormatVersion: 'web.2',
        applicationRevision: 'app-1',
      }),
    ).toBe(false)
    expect(
      planApplies(applicable, {
        scenarioId: 'scnbbbbbbbbbbbb',
        scenarioRevision: 'rev-a',
        executionTargetProfileId: 'web',
        planFormatVersion: 'web.1',
        applicationRevision: 'app-2',
      }),
    ).toBe(false)
  })
})

describe('execution plan store', () => {
  const directories: string[] = []

  afterAll(async () => {
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })

  test('returns only an approved plan that applies to the current query', async () => {
    const store: ExecutionPlanStore = {
      async findApproved(query) {
        return planApplies(applicable, query) ? applicable : undefined
      },
      async saveCandidate() {},
    }
    const found = await store.findApproved({
      scenarioId: 'scnbbbbbbbbbbbb',
      scenarioRevision: 'rev-a',
      executionTargetProfileId: 'web',
      planFormatVersion: 'web.1',
      applicationRevision: 'app-1',
    })
    const otherProfile = await store.findApproved({
      scenarioId: 'scnbbbbbbbbbbbb',
      scenarioRevision: 'rev-a',
      executionTargetProfileId: 'android',
      planFormatVersion: 'web.1',
      applicationRevision: 'app-1',
    })

    expect(found).toEqual(applicable)
    expect(otherProfile).toBeUndefined()
  })

  test('writes a candidate plan without changing the approved plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pickle-plans-'))
    directories.push(root)
    const approvedPath = join(
      root,
      '.pickle',
      'plans',
      'web',
      'scnbbbbbbbbbbbb.json',
    )
    await Bun.write(approvedPath, `${JSON.stringify(applicable, null, 2)}\n`)
    const store = createFilePlanStore(root)
    const candidate: ExecutionPlan = {
      ...applicable,
      steps: [
        {
          resolvedActions: [{ description: 'Use the new search field' }],
        },
      ],
    }

    await store.saveCandidate(candidate)
    const approved = await store.findApproved({
      scenarioId: 'scnbbbbbbbbbbbb',
      scenarioRevision: 'rev-a',
      executionTargetProfileId: 'web',
      planFormatVersion: 'web.1',
      applicationRevision: 'app-1',
    })

    expect(approved).toEqual(applicable)
    expect(
      JSON.parse(
        await Bun.file(
          join(root, '.pickle', 'candidates', 'web', 'scnbbbbbbbbbbbb.json'),
        ).text(),
      ),
    ).toEqual(candidate)
    expect(await Bun.file(approvedPath).text()).toBe(
      `${JSON.stringify(applicable, null, 2)}\n`,
    )
  })

  test('lists candidate plans with their originating test run evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pickle-plan-reviews-'))
    directories.push(root)
    const store = createFilePlanStore(root, {
      candidateEvidence: { testRunId: 'run-adaptation-42' },
    })

    await store.saveCandidate(applicable)

    expect(await store.listReviews()).toEqual([
      {
        scenarioId: 'scnbbbbbbbbbbbb',
        executionTargetProfileId: 'web',
        candidate: {
          ...applicable,
          evidence: { testRunId: 'run-adaptation-42' },
        },
        candidateRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ])
  })

  test('pairs approved and candidate plans for the same Scenario and target profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pickle-plan-pairs-'))
    directories.push(root)
    const approved = {
      ...applicable,
      steps: [{ resolvedActions: [{ description: 'Use the old field' }] }],
    }
    const candidate = {
      ...applicable,
      steps: [{ resolvedActions: [{ description: 'Use the new field' }] }],
    }
    const approvedPath = join(
      root,
      '.pickle',
      'plans',
      'web',
      'scnbbbbbbbbbbbb.json',
    )
    await Bun.write(approvedPath, `${JSON.stringify(approved, null, 2)}\n`)
    const store = createFilePlanStore(root)
    await store.saveCandidate(candidate)

    expect(await store.listReviews()).toEqual([
      {
        scenarioId: 'scnbbbbbbbbbbbb',
        executionTargetProfileId: 'web',
        approved,
        candidate,
        candidateRevision: expect.any(String),
      },
    ])
  })

  test('promotes the reviewed candidate and removes its local evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pickle-plan-promotion-'))
    directories.push(root)
    const store = createFilePlanStore(root, {
      candidateEvidence: { testRunId: 'run-adaptation-42' },
    })
    await store.saveCandidate(applicable)
    const [review] = await store.listReviews()

    const promoted = await store.promoteCandidate({
      scenarioId: applicable.scenarioId,
      executionTargetProfileId: applicable.executionTargetProfileId,
      expectedCandidateRevision: review?.candidateRevision ?? '',
    })

    expect(promoted).toEqual(applicable)
    expect(
      JSON.parse(
        await Bun.file(
          join(root, '.pickle', 'plans', 'web', 'scnbbbbbbbbbbbb.json'),
        ).text(),
      ),
    ).toEqual(applicable)
    expect(
      await Bun.file(
        join(root, '.pickle', 'candidates', 'web', 'scnbbbbbbbbbbbb.json'),
      ).exists(),
    ).toBe(false)
  })

  test('rejects a candidate that changed after review without removing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pickle-stale-promotion-'))
    directories.push(root)
    const store = createFilePlanStore(root)
    await store.saveCandidate(applicable)
    const candidatePath = join(
      root,
      '.pickle',
      'candidates',
      'web',
      'scnbbbbbbbbbbbb.json',
    )

    await expect(
      store.promoteCandidate({
        scenarioId: applicable.scenarioId,
        executionTargetProfileId: applicable.executionTargetProfileId,
        expectedCandidateRevision: 'reviewed-before-the-candidate-changed',
      }),
    ).rejects.toThrow('changed after it was reviewed')
    expect(await Bun.file(candidatePath).exists()).toBe(true)
  })

  test('reports a missing candidate without creating an approved plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pickle-missing-promotion-'))
    directories.push(root)
    const store = createFilePlanStore(root)

    await expect(
      store.promoteCandidate({
        scenarioId: applicable.scenarioId,
        executionTargetProfileId: applicable.executionTargetProfileId,
        expectedCandidateRevision: 'missing',
      }),
    ).rejects.toThrow('no longer available')
    expect(
      await Bun.file(
        join(root, '.pickle', 'plans', 'web', 'scnbbbbbbbbbbbb.json'),
      ).exists(),
    ).toBe(false)
  })
})
