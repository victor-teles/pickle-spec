import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type ExecutionCacheKey,
  openLocalExecutionCache,
  openTestRunStore,
  serializeExecutionCacheEnvelope,
  type TestStepResult,
} from '@pickle-spec/runner'
import { parseSpecification, scenarioRevision } from '@pickle-spec/spec'
import {
  parseWebExecutionCachePayload,
  resolveFidelityPolicy,
  type WebExecutionCachePayload,
  webTargetConfigurationFingerprint,
} from '@pickle-spec/web'

const applicationRevision =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const web = { baseUrl: 'https://example.test/' }
const source = `@pickle:id:speceng04checkout @pickle:state:active
Feature: ENG04 checkout
  @pickle:id:scneng04complete
  Scenario: Complete cached plan
    When I enter account credentials
    Then I see the account

  @pickle:id:scneng04partial
  Scenario: Partial cached plan
    When I enter account credentials
    Then I see the account

  @pickle:id:scneng04malformed
  Scenario: Malformed cached plan
    Then I see the account

  @pickle:id:scneng04absent
  Scenario: No cached plan yet
    When I enter account credentials
`

const validator = {
  adapterKind: 'web',
  adapterCacheSchemaVersion: '1',
  parse: parseWebExecutionCachePayload,
  prefixStepCount: (payload: WebExecutionCachePayload) => payload.steps.length,
}

const locator = (literal: string) => ({
  selector: { segments: [{ literal }] },
})

const inputStep = {
  instructions: [
    { kind: 'hover' as const, locator: locator('#account-help') },
    {
      kind: 'fill' as const,
      locator: locator('#password'),
      value: { segments: [{ literal: 'eng04-super-secret' }] },
    },
    {
      kind: 'navigate' as const,
      url: {
        segments: [
          {
            literal:
              'https://user:pass@example.test/account?access_token=eng04-url-secret',
          },
        ],
      },
    },
  ],
}

const assertionStep = {
  instructions: [
    {
      kind: 'visible' as const,
      locator: locator('#account'),
    },
  ],
}

export type ExecutionPlanBrowserProject = {
  cache: Awaited<ReturnType<typeof openLocalExecutionCache>>
  cacheRoot: string
  pickleHome: string
  project: string
}

export async function createExecutionPlanBrowserProject(
  project: string,
  workspace: string,
): Promise<ExecutionPlanBrowserProject> {
  const cacheRoot = join(workspace, 'eng04-cache')
  const pickleHome = join(workspace, 'eng04-home')
  await mkdir(join(project, 'features'), { recursive: true })
  await Bun.write(join(project, 'features', 'eng04.feature'), source)
  await Bun.write(
    join(project, 'pickle.config.jsonc'),
    JSON.stringify({
      schemaVersion: 1,
      specifications: 'features/eng04.feature',
      applicationRevision,
      executionTargetProfiles: {
        browser: { adapter: 'web', web },
        custom: { adapter: 'custom' },
      },
    }),
  )
  const cache = await openLocalExecutionCache({
    projectRoot: project,
    cacheRoot,
  })
  const specification = parseSpecification({
    uri: 'features/eng04.feature',
    source,
  })
  const fingerprint = webTargetConfigurationFingerprint({
    options: web,
    behavior: {},
    fidelity: resolveFidelityPolicy(web),
  })
  const payloads = new Map<string, WebExecutionCachePayload>([
    [
      'scneng04complete',
      { schemaVersion: 1, steps: [inputStep, assertionStep] },
    ],
    ['scneng04partial', { schemaVersion: 1, steps: [inputStep] }],
    [
      'scneng04malformed',
      {
        schemaVersion: 1,
        steps: [
          {
            instructions: [
              {
                kind: 'fill',
                locator: locator('#unexpected-input'),
                value: { segments: [{ literal: 'invalid-for-then' }] },
              },
            ],
          },
        ],
      },
    ],
  ])
  for (const scenario of specification.scenarios) {
    const scenarioId = scenario.id
    if (!scenarioId) throw new Error('ENG04 scenarios require stable IDs')
    const payload = payloads.get(scenarioId)
    if (!payload) continue
    const key: ExecutionCacheKey = {
      projectKey: cache.projectKey,
      scenarioId,
      scenarioRevision: scenarioRevision(scenario),
      executionTargetProfileId: 'browser',
      targetConfigurationFingerprint: fingerprint,
      applicationRevision,
      adapterKind: 'web',
      adapterCacheSchemaVersion: '1',
    }
    await cache.write(
      serializeExecutionCacheEnvelope(
        {
          schemaVersion: 1,
          key,
          requiredVariables: [],
          adapterPayload: payload,
        },
        validator,
      ),
      { sourceRunId: `seed-${scenarioId}`, evaluationInferenceCount: 1 },
    )
  }
  await createFailedRun(project, pickleHome)
  return { cache, cacheRoot, pickleHome, project }
}

async function createFailedRun(project: string, pickleHome: string) {
  const startedAt = '2026-09-04T12:00:00.000Z'
  const finishedAt = '2026-09-04T12:00:00.010Z'
  const failedStep: TestStepResult = {
    index: 1,
    step: {
      keyword: 'Then',
      text: 'I see the account',
      type: 'outcome',
    },
    state: 'failed',
    startedAt,
    finishedAt,
    durationMs: 10,
    message: 'Account panel was hidden',
    resolvedActions: [],
  }
  const store = openTestRunStore({
    root: project,
    pickleHome,
    createId: () => 'eng04-failed-run',
    now: () => new Date(startedAt),
  })
  const run = await store.create({ suite: 'ENG04 browser acceptance' })
  await run.append({
    type: 'scenario-finished',
    specification: { name: 'ENG04 checkout', uri: 'features/eng04.feature' },
    scenario: { id: 'scneng04complete', name: 'Complete cached plan' },
    executionTargetProfile: { id: 'browser', adapter: 'web' },
    scope: {
      scenarioId: 'scneng04complete',
      executionTargetProfileId: 'browser',
      attempt: 1,
    },
    attempt: {
      attempt: 1,
      startedAt,
      finishedAt,
      durationMs: 10,
      state: 'failed',
      steps: [
        {
          index: 0,
          step: {
            keyword: 'When',
            text: 'I enter account credentials',
            type: 'action',
          },
          state: 'passed',
          startedAt,
          finishedAt: '2026-09-04T12:00:00.001Z',
          durationMs: 1,
          resolvedActions: [],
        },
        failedStep,
      ],
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
      evidenceAvailability: [
        { kind: 'screenshot', state: 'not-requested' },
        { kind: 'trace', state: 'not-supported' },
        { kind: 'recording', state: 'not-supported' },
        { kind: 'device-log', state: 'not-supported' },
        { kind: 'diagnostics', state: 'not-requested' },
      ],
    },
  })
  await run.materialize()
}
