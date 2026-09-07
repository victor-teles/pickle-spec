import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ExecutionCacheKey,
  openLocalExecutionCache,
  openLocalExecutionPlanStore,
  type PlanScope,
  serializeExecutionCacheEnvelope,
} from '@pickle-spec/runner'
import { parseSpecification, scenarioRevision } from '@pickle-spec/spec'
import {
  parseWebExecutionCachePayload,
  resolveFidelityPolicy,
  type WebExecutionCachePayload,
  webTargetConfigurationFingerprint,
} from '@pickle-spec/web'
import { afterEach, describe, expect, test } from 'vitest'
import type { PickleConfig } from '../../../src/configuration/config'
import { requiredValue } from '../../../src/required-value'
import { createStudioExecutionPlanService } from '../../../src/studio/studio-execution-plans'

const roots: string[] = []
const web = { baseUrl: 'https://example.test' }
const config: PickleConfig = {
  schemaVersion: 1,
  applicationRevision: 'app-1',
  executionTargetProfiles: { browser: { adapter: 'web', web } },
}
const specification = parseSpecification({
  uri: 'features/account.feature',
  source: `Feature: Account
  Scenario: Sign in
    When I enter credentials
    Then I see the account
`,
})
const scenario = requiredValue(specification.scenarios[0])
const scenarioId = requiredValue(scenario.id)
const partialPayload: WebExecutionCachePayload = {
  schemaVersion: 1,
  steps: [
    {
      instructions: [
        {
          kind: 'fill',
          locator: { selector: { segments: [{ literal: '#password' }] } },
          value: { segments: [{ literal: 'secret' }] },
        },
      ],
    },
  ],
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function fixture(
  applicationRevision = 'app-1',
  profileId = 'browser',
  adapterPayload = partialPayload,
  requiredVariables: string[] = [],
) {
  const root = await mkdtemp(join(tmpdir(), 'pickle-plan-'))
  roots.push(root)
  const cache = await openLocalExecutionCache({
    projectRoot: root,
    cacheRoot: join(root, '.cache'),
  })
  const fingerprint = webTargetConfigurationFingerprint({
    options: web,
    behavior: {},
    fidelity: resolveFidelityPolicy(web),
  })
  const key: ExecutionCacheKey = {
    projectKey: cache.projectKey,
    scenarioId,
    scenarioRevision: scenarioRevision(scenario),
    executionTargetProfileId: profileId,
    targetConfigurationFingerprint: fingerprint,
    applicationRevision,
    adapterKind: 'web',
    adapterCacheSchemaVersion: '1',
  }
  const validator = {
    adapterKind: 'web',
    adapterCacheSchemaVersion: '1',
    parse: parseWebExecutionCachePayload,
    prefixStepCount: (
      payload: NonNullable<ReturnType<typeof parseWebExecutionCachePayload>>,
    ) => payload.steps.length,
  }
  const serialized = serializeExecutionCacheEnvelope(
    {
      schemaVersion: 1,
      key,
      requiredVariables,
      adapterPayload,
    },
    validator,
  )
  await cache.write(serialized, {
    sourceRunId: `run-${applicationRevision}`,
    evaluationInferenceCount: 1,
  })
  return { cache, key, root }
}

describe('Studio readable execution plan service', () => {
  test('returns a partial current plan without changing cache-use metadata', async () => {
    const { cache } = await fixture()
    const before = await cache.inspect()
    const service = createStudioExecutionPlanService({
      loadProject: async () => ({ config, specifications: [specification] }),
      openCache: async () => cache,
      resolveApplicationRevision: (value) => value,
    })

    const plan = await service.read({
      scenarioId,
      profileId: 'browser',
    })

    expect(plan).toMatchObject({
      state: 'available',
      publication: { sourceRunId: 'run-app-1' },
      applicability: { state: 'applicable' },
      steps: [{ index: 0, text: 'I enter credentials' }],
      uncachedTail: [{ index: 1, text: 'I see the account' }],
    })
    expect(await cache.inspect()).toEqual(before)
  })

  test('requires an explicit revision when deployment and candidates are ambiguous', async () => {
    const first = await fixture('app-1')
    const secondKey = { ...first.key, applicationRevision: 'app-2' }
    const current = await first.cache.coordination.readCurrent(first.key)
    expect(current).toBeDefined()
    const source = JSON.parse(requiredValue(current).source)
    source.key = secondKey
    await first.cache.write(
      serializeExecutionCacheEnvelope(source, {
        adapterKind: 'web',
        adapterCacheSchemaVersion: '1',
        parse: parseWebExecutionCachePayload,
        prefixStepCount: (payload) => payload.steps.length,
      }),
      { sourceRunId: 'run-app-2', evaluationInferenceCount: 0 },
    )
    const service = createStudioExecutionPlanService({
      loadProject: async () => ({
        config: { ...config, applicationRevision: undefined },
        specifications: [specification],
      }),
      openCache: async () => first.cache,
      resolveApplicationRevision: () => {},
    })

    const ambiguous = await service.read({
      scenarioId,
      profileId: 'browser',
    })
    expect(ambiguous).toMatchObject({
      state: 'unavailable',
      reason: 'ambiguous-application-revision',
      applicationRevisions: ['app-1', 'app-2'],
    })

    const selected = await service.read({
      scenarioId,
      profileId: 'browser',
      applicationRevision: 'app-2',
    })
    expect(selected).toMatchObject({
      state: 'available',
      applicability: {
        state: 'unverified',
        storedApplicationRevision: 'app-2',
      },
      publication: { sourceRunId: 'run-app-2' },
    })

    const configuredMismatch = createStudioExecutionPlanService({
      loadProject: async () => ({
        config: { ...config, applicationRevision: 'app-3' },
        specifications: [specification],
      }),
      openCache: async () => first.cache,
      resolveApplicationRevision: (value) => value,
    })
    const mismatch = await configuredMismatch.read({
      scenarioId,
      profileId: 'browser',
    })
    expect(mismatch).toMatchObject({
      state: 'unavailable',
      reason: 'incompatible-cache-entry',
      nextAction:
        'Run the Scenario against the configured application revision.',
    })
    expect(mismatch).not.toHaveProperty('applicationRevisions')
  })

  test('reports unsupported profiles and incompatible retained entries', async () => {
    const { cache } = await fixture()
    const mobile = createStudioExecutionPlanService({
      loadProject: async () => ({
        config: {
          ...config,
          executionTargetProfiles: { phone: { adapter: 'mobile' } },
        },
        specifications: [specification],
      }),
      openCache: async () => cache,
      resolveApplicationRevision: (value) => value,
    })
    expect(await mobile.read({ scenarioId, profileId: 'phone' })).toMatchObject(
      {
        state: 'unavailable',
        reason: 'unsupported-adapter',
      },
    )

    const changedSpecification = parseSpecification({
      uri: 'features/account.feature',
      source: `Feature: Account
  Scenario: Sign in
    When I enter different credentials
    Then I see the account
`,
    })
    requiredValue(changedSpecification.scenarios[0]).id = scenario.id
    const changed = createStudioExecutionPlanService({
      loadProject: async () => ({
        config,
        specifications: [changedSpecification],
      }),
      openCache: async () => cache,
      resolveApplicationRevision: (value) => value,
    })
    expect(
      await changed.read({ scenarioId, profileId: 'browser' }),
    ).toMatchObject({
      state: 'unavailable',
      reason: 'incompatible-cache-entry',
    })
  })

  test('reads the legacy default web profile', async () => {
    const { cache } = await fixture('app-1', 'web')
    const service = createStudioExecutionPlanService({
      loadProject: async () => ({
        config: { schemaVersion: 1, applicationRevision: 'app-1', web },
        specifications: [specification],
      }),
      openCache: async () => cache,
      resolveApplicationRevision: (value) => value,
    })

    expect(await service.read({ scenarioId, profileId: 'web' })).toMatchObject({
      state: 'available',
      applicability: { state: 'applicable' },
    })
  })

  test('rejects unknown variables and instructions in the wrong Gherkin role', async () => {
    const unknownVariable = await fixture('app-1', 'browser', partialPayload, [
      'ghost',
    ])
    const project = async () => ({ config, specifications: [specification] })
    const invalidVariables = createStudioExecutionPlanService({
      loadProject: project,
      openCache: async () => unknownVariable.cache,
      resolveApplicationRevision: (value) => value,
    })
    expect(
      await invalidVariables.read({ scenarioId, profileId: 'browser' }),
    ).toMatchObject({
      state: 'unavailable',
      reason: 'incompatible-cache-entry',
    })

    const roleMismatch = await fixture('app-1', 'browser', {
      schemaVersion: 1,
      steps: [
        requiredValue(partialPayload.steps[0]),
        {
          instructions: [
            {
              kind: 'click',
              locator: { selector: { segments: [{ literal: '#wrong-role' }] } },
            },
          ],
        },
      ],
    })
    const invalidRole = createStudioExecutionPlanService({
      loadProject: project,
      openCache: async () => roleMismatch.cache,
      resolveApplicationRevision: (value) => value,
    })
    expect(
      await invalidRole.read({ scenarioId, profileId: 'browser' }),
    ).toMatchObject({
      state: 'unavailable',
      reason: 'incompatible-cache-entry',
    })
  })

  test('captures and edits an immutable draft without changing selection', async () => {
    const { cache, root } = await fixture()
    const store = await openLocalExecutionPlanStore({ projectRoot: root })
    const service = createStudioExecutionPlanService({
      loadProject: async () => ({ config, specifications: [specification] }),
      openCache: async () => cache,
      openPlanStore: async () => store,
      resolveApplicationRevision: (value) => value,
    })

    const captured = await service.captureDraft({
      scenarioId,
      profileId: 'browser',
    })
    expect(captured.ok).toBe(true)
    if (!captured.ok) return
    const editable = captured.value.steps[0]?.operations[0]?.editable
    expect(editable).toBeDefined()
    const edited = await service.edit({
      scenarioId,
      profileId: 'browser',
      parentRevisionId: captured.value.revisionId,
      step: {
        scenarioRevision: scenarioRevision(scenario),
        index: 0,
      },
      instructionIndex: 0,
      expectedInstructionDigest: requiredValue(editable).instructionDigest,
      locator: {
        selector: { segments: [{ literal: '#new-password' }] },
      },
    })

    expect(edited).toMatchObject({ ok: true, value: { state: 'draft' } })
    if (!edited.ok) return
    expect(edited.value.revisionId).not.toBe(captured.value.revisionId)
    expect(edited.value.steps[0]?.operations[0]?.target).toMatchObject({
      selector: { segments: [{ kind: 'literal', value: '#new-password' }] },
    })
    const scope = edited.value.scope
    const history = await store.inspect(scope)
    expect(history).toMatchObject({
      ok: true,
      value: { selection: { state: 'absent' } },
    })
    const parent = await store.readRevision(captured.value.revisionId)
    expect(parent).toMatchObject({
      ok: true,
      value: { origin: { kind: 'cache-capture' } },
    })
  })
})
