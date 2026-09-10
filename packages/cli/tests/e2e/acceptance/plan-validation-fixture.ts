import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type ExecutionCacheKey,
  openLocalExecutionCache,
  openLocalExecutionPlanStore,
  planDigest,
  serializeExecutionCacheEnvelope,
} from '@pickle-spec/runner'
import { parseSpecification, scenarioRevision } from '@pickle-spec/spec'
import {
  parseWebExecutionCachePayload,
  resolveFidelityPolicy,
  type WebAutomation,
  type WebExecutionCachePayload,
  type WebInstruction,
  webTargetConfigurationFingerprint,
} from '@pickle-spec/web'
import type { PickleConfig } from '../../../src/configuration/config'
import { createStudioExecutionPlanService } from '../../../src/studio/studio-execution-plans'
import { createStudioPlanValidationService } from '../../../src/studio/execution-plan-validation/service'
import type { WebAutomationFactory } from '@pickle-spec/web'
import {
  acceptanceBaseUrl,
  digest,
  type FixtureVariant,
} from './checkout-browser'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const fixtureDirectory = resolve(
  testDirectory,
  '../../../../../apps/example/acceptance',
)
const profileId = 'browser'
const validationFactories = new Map<string, WebAutomationFactory>()

export function webAutomationFactoryFor(root: string): WebAutomationFactory {
  const factory = validationFactories.get(root)
  if (!factory) throw new Error(`No validation automation factory for ${root}`)
  return factory
}

export function delayedInstructionFactory(
  factory: WebAutomationFactory,
  delayMs: () => number,
  instructionKind: WebInstruction['kind'],
): WebAutomationFactory {
  return {
    async launch(input) {
      const browser = await factory.launch(input)
      return {
        async openContext(contextInput) {
          const automation = await browser.openContext(contextInput)
          const executeInstruction =
            automation.executeInstruction?.bind(automation)
          if (!executeInstruction)
            throw new Error('Direct execution is unavailable')
          return {
            navigate: automation.navigate.bind(automation),
            observe: automation.observe.bind(automation),
            act: automation.act.bind(automation),
            verify: automation.verify.bind(automation),
            compileAssertion: automation.compileAssertion?.bind(automation),
            async executeInstruction(instruction, bindings, signal) {
              if (instruction.kind === instructionKind) {
                await new Promise((resolveDelay) =>
                  setTimeout(resolveDelay, delayMs()),
                )
              }
              return executeInstruction(instruction, bindings, signal)
            },
            screenshot: automation.screenshot.bind(automation),
            readIsolationState: automation.readIsolationState.bind(automation),
            close: automation.close.bind(automation),
          } satisfies WebAutomation
        },
        close: () => browser.close(),
      }
    },
  }
}

const locator = (literal: string) => ({ selector: { segments: [{ literal }] } })
const template = (literal: string) => ({ segments: [{ literal }] })

function baselinePayload(url: string): WebExecutionCachePayload {
  const instructions: WebInstruction[][] = [
    [{ kind: 'navigate', url: template(url) }],
    [
      {
        kind: 'fill',
        locator: locator('#username'),
        value: template('acceptance_user'),
      },
      {
        kind: 'fill',
        locator: locator('#password'),
        value: template('pickle_pass'),
      },
      { kind: 'click', locator: locator('#login-form button[type="submit"]') },
    ],
    [{ kind: 'visible', locator: locator('#catalog-view') }],
    [{ kind: 'click', locator: locator('#add-backpack') }],
    [
      {
        kind: 'text-equals',
        locator: locator('#basket-count'),
        expected: template('1'),
      },
    ],
    [{ kind: 'click', locator: locator('#start-checkout') }],
    [
      {
        kind: 'text-equals',
        locator: locator('#summary-count'),
        expected: template('1'),
      },
      {
        kind: 'text-equals',
        locator: locator('#order-total'),
        expected: template('$29.99'),
      },
    ],
    [{ kind: 'click', locator: locator('#place-order') }],
    [
      {
        kind: 'text-equals',
        locator: locator('#order-count'),
        expected: template('1'),
      },
    ],
  ]
  return {
    schemaVersion: 1,
    steps: instructions.map((group) => ({ instructions: group })),
  }
}

export async function createPlanValidationFixture(
  variant: FixtureVariant,
  webAutomationFactory: WebAutomationFactory,
  options: { stepTimeoutMs?: number } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'pickle-eng07-'))
  const [source, html] = await Promise.all([
    Bun.file(join(fixtureDirectory, 'checkout.feature')).text(),
    Bun.file(join(fixtureDirectory, 'index.html')).text(),
  ])
  const specification = parseSpecification({
    uri: 'features/checkout.feature',
    source,
  })
  const scenario = specification.scenarios[0]
  if (!scenario?.id)
    throw new Error('The acceptance Scenario requires an identity')
  const web = { baseUrl: `${acceptanceBaseUrl}?variant=${variant}` }
  const applicationRevision = digest(`${html}\0${variant}`)
  const config: PickleConfig = {
    schemaVersion: 1,
    specifications: 'features/checkout.feature',
    applicationRevision,
    executionTargetProfiles: { [profileId]: { adapter: 'web', web } },
    evidence: { persistence: 'always' },
    execution: { stepTimeoutMs: options.stepTimeoutMs },
  }
  await mkdir(join(root, 'features'))
  await Bun.write(join(root, 'features/checkout.feature'), source)
  await Bun.write(join(root, 'pickle.config.jsonc'), JSON.stringify(config))
  validationFactories.set(root, webAutomationFactory)
  const fixtureModule = join(testDirectory, 'plan-validation-fixture.ts')
  await Bun.write(
    join(root, 'pickle.extensions.ts'),
    `import { webAutomationFactoryFor } from ${JSON.stringify(fixtureModule)}\nexport default { webAutomationFactory: webAutomationFactoryFor(${JSON.stringify(root)}) }\n`,
  )
  const cache = await openLocalExecutionCache({
    projectRoot: root,
    cacheRoot: join(root, '.cache'),
  })
  const store = await openLocalExecutionPlanStore({ projectRoot: root })
  const key: ExecutionCacheKey = {
    projectKey: cache.projectKey,
    scenarioId: scenario.id,
    scenarioRevision: scenarioRevision(scenario),
    executionTargetProfileId: profileId,
    targetConfigurationFingerprint: webTargetConfigurationFingerprint({
      options: web,
      behavior: {},
      fidelity: resolveFidelityPolicy(web),
    }),
    applicationRevision,
    adapterKind: 'web',
    adapterCacheSchemaVersion: '1',
  }
  const payload = baselinePayload(web.baseUrl)
  await cache.write(
    serializeExecutionCacheEnvelope(
      {
        schemaVersion: 1,
        key,
        requiredVariables: [],
        adapterPayload: payload,
      },
      {
        adapterKind: 'web',
        adapterCacheSchemaVersion: '1',
        parse: parseWebExecutionCachePayload,
        prefixStepCount: (value) => value.steps.length,
      },
    ),
    { sourceRunId: 'synthetic-stale-plan-seed', evaluationInferenceCount: 0 },
  )
  const service = createStudioExecutionPlanService({
    loadProject: async () => ({ config, specifications: [specification] }),
    openCache: async () => cache,
    openPlanStore: async () => store,
    resolveApplicationRevision: (value) => value,
  })
  const validationService = createStudioPlanValidationService({
    root,
    loadConfig: async () => config,
  })
  const request = { scenarioId: scenario.id, profileId }
  const captured = await service.captureDraft(request)
  if (!captured.ok) throw new Error(captured.message)
  const selection = await store.writeSelection({
    scope: captured.value.scope,
    active: { revisionId: captured.value.revisionId },
    expectedSelectionDigest: null,
    actor: { kind: 'human', id: 'acceptance-fixture' },
    reason: 'activate',
  })
  if (!selection.ok) throw new Error(selection.message)
  const checkout = payload.steps[5]?.instructions[0]
  if (!checkout) throw new Error('The checkout interaction is missing')
  const edited = await service.edit({
    ...request,
    parentRevisionId: captured.value.revisionId,
    step: { scenarioRevision: key.scenarioRevision, index: 5 },
    instructionIndex: 0,
    expectedInstructionDigest: planDigest(checkout),
    locator: locator('#review-order'),
  })
  if (!edited.ok) throw new Error(edited.message)
  return {
    root,
    config,
    specification,
    scenario,
    html,
    cache,
    store,
    key,
    payload,
    service,
    validationService,
    request,
    captured: captured.value,
    edited: edited.value,
    selection: selection.value,
    dispose() {
      validationFactories.delete(root)
    },
  }
}
