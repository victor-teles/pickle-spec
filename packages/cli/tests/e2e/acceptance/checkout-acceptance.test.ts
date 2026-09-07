import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  finalScenarioAttempt,
  openLocalExecutionCache,
  runScenario,
  type ScenarioRun,
} from '@pickle-spec/runner'
import { parseSpecification, scenarioRevision } from '@pickle-spec/spec'
import { createWebAdapter } from '@pickle-spec/web'
import { type Browser, chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  acceptanceFactory,
  acceptanceBaseUrl as baseUrl,
  type CompilerTarget,
  digest,
  type FixtureVariant,
} from './checkout-browser'

type RunEvidence = {
  applicationRevision: string
  cacheOutcome?: string
  executionMode?: string
  failedMessage?: string
  failedStep?: string
  failureKind?: string
  inferenceCount?: number
  name: string
  scenarioRevision: string
  screenshot?: { mediaType?: string; path: string; sizeBytes?: number }
  state: string
}

type RunCaseInput = {
  applicationRevisionLabel?: string
  cacheName: string
  compilerTarget: CompilerTarget
  name: string
  policy?: 'cache-only'
  sourceRunId: string
  variant: FixtureVariant
}

const fixtureDirectory = resolve(
  import.meta.dir,
  '../../../../../apps/example/acceptance',
)
const featurePath = join(fixtureDirectory, 'checkout.feature')
const htmlPath = join(fixtureDirectory, 'index.html')
const auditDirectory = resolve(
  process.env.PICKLE_ENG02_OUTPUT_DIR ??
    resolve(import.meta.dir, '../../../../../.audit/eng02'),
)

function evidenceFor(
  name: string,
  applicationRevision: string,
  run: ScenarioRun,
): RunEvidence {
  const attempt = finalScenarioAttempt(run.result)
  const failed = attempt.steps.find((step) => step.state !== 'passed')
  const screenshot = failed?.artifacts?.find(
    (artifact) => artifact.kind === 'screenshot',
  )
  const evidence: RunEvidence = {
    name,
    applicationRevision,
    scenarioRevision: scenarioRevisionValue,
    state: attempt.state,
    cacheOutcome: attempt.cacheOutcome,
    executionMode: attempt.executionMode,
    failureKind: attempt.failureKind,
    inferenceCount: attempt.inferenceCount,
    failedStep: failed?.step.text,
    failedMessage: failed?.message ?? attempt.message,
  }
  if (screenshot) {
    evidence.screenshot = {
      path: screenshot.path,
      mediaType: screenshot.mediaType,
      sizeBytes: screenshot.sizeBytes,
    }
  }
  return evidence
}

let browser: Browser
let html = ''
let specification: ReturnType<typeof parseSpecification>
let scenarioRevisionValue = ''
let scenario: ReturnType<typeof parseSpecification>['scenarios'][number]
let workspace = ''
const recordedEvidence: RunEvidence[] = []

beforeAll(async () => {
  ;[html, specification] = await Promise.all([
    Bun.file(htmlPath).text(),
    Bun.file(featurePath)
      .text()
      .then((source) =>
        parseSpecification({ uri: 'acceptance/checkout.feature', source }),
      ),
  ])
  const parsedScenario = specification.scenarios[0]
  if (!parsedScenario)
    throw new Error('Acceptance feature must contain one Scenario')
  scenario = parsedScenario
  scenarioRevisionValue = scenarioRevision(scenario)
  workspace = await mkdtemp(join(tmpdir(), 'pickle-eng02-'))
  await mkdir(auditDirectory, { recursive: true })
  browser = await chromium.launch({ channel: 'chrome', headless: true })
}, 60_000)

afterAll(async () => {
  await Bun.write(
    join(auditDirectory, 'acceptance-evidence.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), cases: recordedEvidence }, null, 2)}\n`,
  )
  await browser?.close()
  if (workspace) await rm(workspace, { recursive: true, force: true })
})

async function runCase(input: RunCaseInput) {
  const revisionLabel = input.applicationRevisionLabel ?? input.variant
  const applicationRevision = digest(`${html}\0${revisionLabel}`)
  const cache = await openLocalExecutionCache({
    projectRoot: fixtureDirectory,
    cacheRoot: join(workspace, input.cacheName),
  })
  const launches = { count: 0 }
  const adapter = createWebAdapter(
    {
      baseUrl: `${baseUrl}?variant=${input.variant}`,
      screenshots: {
        mode: 'on-failure',
        outputDir: join(auditDirectory, input.name),
        format: 'png',
        fullPage: true,
      },
    },
    acceptanceFactory({
      browser,
      html,
      compilerTarget: input.compilerTarget,
      launches,
    }),
  )
  try {
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'eng02-chrome' },
      adapter,
      executionCache: {
        store: cache,
        projectKey: cache.projectKey,
        sourceRunId: input.sourceRunId,
      },
      applicationRevision,
      cachePolicy: input.policy,
    })
    recordedEvidence.push(evidenceFor(input.name, applicationRevision, run))
    return { run, launches: launches.count, applicationRevision }
  } finally {
    await adapter.dispose?.()
  }
}

describe('ENG-02 synthetic checkout acceptance', () => {
  test('passes cold and cache-only while keeping each browser context isolated', async () => {
    const cold = await runCase({
      cacheName: 'original',
      compilerTarget: 'original',
      name: 'original-cold',
      sourceRunId: 'original-cold',
      variant: 'original',
    })
    const replay = await runCase({
      cacheName: 'original',
      compilerTarget: 'original',
      name: 'original-cache-only',
      policy: 'cache-only',
      sourceRunId: 'original-replay',
      variant: 'original',
    })

    expect(finalScenarioAttempt(cold.run.result)).toMatchObject({
      state: 'passed',
      executionMode: 'adaptive',
      cacheOutcome: 'miss',
    })
    expect(finalScenarioAttempt(replay.run.result)).toMatchObject({
      state: 'passed',
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
    })
    expect(replay.applicationRevision).toBe(cold.applicationRevision)
  }, 60_000)

  test('cache-only misses a new application revision without browser or inference work', async () => {
    const miss = await runCase({
      cacheName: 'original',
      compilerTarget: 'original',
      name: 'application-revision-cache-only-miss',
      policy: 'cache-only',
      sourceRunId: 'revision-miss',
      variant: 'original',
      applicationRevisionLabel: 'original-unseeded-revision',
    })
    expect(finalScenarioAttempt(miss.run.result)).toMatchObject({
      state: 'failed',
      failureKind: 'cache-miss',
      cacheOutcome: 'miss',
      inferenceCount: 0,
    })
    expect(miss.launches).toBe(0)
  })

  test('fails on a stale target and passes after a locator-only repair', async () => {
    const stale = await runCase({
      cacheName: 'changed-stale',
      compilerTarget: 'original',
      name: 'changed-target-stale-compiler',
      sourceRunId: 'changed-stale',
      variant: 'changed-target',
    })
    const repaired = await runCase({
      cacheName: 'changed-repaired',
      compilerTarget: 'changed-target',
      name: 'changed-target-repaired',
      sourceRunId: 'changed-repaired',
      variant: 'changed-target',
    })
    const repairedReplay = await runCase({
      cacheName: 'changed-repaired',
      compilerTarget: 'changed-target',
      name: 'changed-target-repaired-cache-only',
      policy: 'cache-only',
      sourceRunId: 'changed-repaired-replay',
      variant: 'changed-target',
    })
    const staleAttempt = finalScenarioAttempt(stale.run.result)
    expect(staleAttempt.state).toBe('failed')
    expect(
      staleAttempt.steps.find((step) => step.state === 'failed'),
    ).toMatchObject({
      step: { text: 'I start checkout' },
      message: expect.stringContaining('No element matches #start-checkout'),
    })
    expect(finalScenarioAttempt(repaired.run.result).state).toBe('passed')
    expect(finalScenarioAttempt(repairedReplay.run.result)).toMatchObject({
      state: 'passed',
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
    })
  }, 60_000)

  test('keeps a wrong business total failed after the identical locator repair', async () => {
    const regression = await runCase({
      cacheName: 'business-regression',
      compilerTarget: 'changed-target',
      name: 'business-regression-repaired-locator',
      sourceRunId: 'business-regression',
      variant: 'business-regression',
    })
    const attempt = finalScenarioAttempt(regression.run.result)
    const failed = attempt.steps.find((step) => step.state === 'failed')
    expect(failed).toMatchObject({
      step: {
        text: 'the order summary shows one backpack with a total of $29.99',
      },
      message: expect.stringContaining('$39.99'),
    })
    const screenshot = failed?.artifacts?.find(
      (artifact) => artifact.kind === 'screenshot',
    )
    expect(screenshot).toMatchObject({ mediaType: 'image/png' })
    if (!screenshot)
      throw new Error('Business failure must retain a screenshot')
    expect(
      await Bun.file(screenshot.path)
        .arrayBuffer()
        .then((bytes) => new Uint8Array(bytes).slice(0, 8)),
    ).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  })

  test('rejects invalid login, persists one session through reload, resets, and isolates a new context', async () => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 720 },
    })
    await context.route(`${baseUrl}**`, (route) =>
      route.fulfill({ body: html, contentType: 'text/html' }),
    )
    const page = await context.newPage()
    await page.goto(`${baseUrl}?variant=original`)
    await page.locator('#username').fill('wrong')
    await page.locator('#password').fill('wrong')
    await page.locator('#login-form button').click()
    expect(await page.locator('#login-error').isVisible()).toBe(true)
    await page.locator('#username').fill('acceptance_user')
    await page.locator('#password').fill('pickle_pass')
    await page.locator('#login-form button').click()
    await page.locator('#add-backpack').click()
    await page.locator('#start-checkout').click()
    await page.locator('#place-order').click()
    await page.reload()
    expect(await page.locator('#order-count').textContent()).toBe('1')

    const isolatedContext = await browser.newContext({
      viewport: { width: 320, height: 720 },
    })
    await isolatedContext.route(`${baseUrl}**`, (route) =>
      route.fulfill({ body: html, contentType: 'text/html' }),
    )
    const isolatedPage = await isolatedContext.newPage()
    await isolatedPage.goto(`${baseUrl}?variant=original`)
    expect(await isolatedPage.locator('#login-view').isVisible()).toBe(true)
    expect(await isolatedPage.locator('#basket-count').textContent()).toBe('0')
    expect(await isolatedPage.locator('#order-count').textContent()).toBe('0')
    expect(await page.locator('#order-count').textContent()).toBe('1')
    await page.locator('#reset').click()
    expect(await page.locator('#login-view').isVisible()).toBe(true)
    expect(await page.locator('#basket-count').textContent()).toBe('0')
    expect(await page.locator('#order-count').textContent()).toBe('0')
    expect(await page.locator('#username').inputValue()).toBe('')
    expect(await page.locator('#password').inputValue()).toBe('')
    await isolatedContext.close()
    await context.close()
  })
})
