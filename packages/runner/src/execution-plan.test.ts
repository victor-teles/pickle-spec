import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createFilePlanStore,
  createMemoryPlanStore,
  type ExecutionPlan,
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
    const store = createMemoryPlanStore([applicable])
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
})
