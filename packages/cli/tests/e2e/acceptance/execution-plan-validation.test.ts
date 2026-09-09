import { rm } from 'node:fs/promises'
import {
  finalScenarioAttempt,
  openTestRunStore,
  planDigest,
} from '@pickle-spec/runner'
import { type Browser, chromium } from 'playwright'
import { parseWebExecutionCachePayload } from '@pickle-spec/web'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { z } from 'zod'
import { acceptanceFactory, type FixtureVariant } from './checkout-browser'
import {
  createPlanValidationFixture,
  delayedInstructionFactory,
} from './plan-validation-fixture'

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
}, 60_000)

afterAll(async () => {
  await browser?.close()
})

const cases: Array<{ variant: FixtureVariant; expected: 'passed' | 'failed' }> =
  [
    { variant: 'changed-target', expected: 'passed' },
    { variant: 'business-regression', expected: 'failed' },
  ]

test('does not issue a receipt when the run rejects after passing Scenario actions', async () => {
  const fixture = await createPlanValidationFixture(
    'changed-target',
    acceptanceFactory({
      browser,
      html: await Bun.file(
        new URL(
          '../../../../../apps/example/acceptance/index.html',
          import.meta.url,
        ),
      ).text(),
      compilerTarget: 'original',
      launches: { count: 0 },
    }),
  )
  try {
    const cacheBefore = await fixture.cache.inspect()
    const selectionBefore = await fixture.store.inspect(fixture.captured.scope)
    const review = await fixture.validationService.review({
      revisionId: fixture.edited.revisionId,
      rationale: 'The target preserves checkout intent.',
      evidenceRunIds: [],
    })
    if (!review.ok) throw new Error(review.message)
    const request = {
      revisionId: fixture.edited.revisionId,
      reviewId: review.value.reviewId,
      resetConfirmed: true as const,
    }
    const started = await fixture.validationService.start(request, {
      onResult() {
        throw new Error('Result delivery failed')
      },
    })
    await expect(started.done).rejects.toThrow('Result delivery failed')
    expect(await fixture.validationService.status(request)).toEqual({
      ok: true,
      value: { state: 'failed', runId: started.id },
    })
    expect(await fixture.cache.inspect()).toEqual(cacheBefore)
    expect(await fixture.store.inspect(fixture.captured.scope)).toEqual(
      selectionBefore,
    )
  } finally {
    fixture.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
}, 60_000)

test.each(cases)(
  'executes the saved $variant candidate in Chrome and preserves cache and selection',
  async ({ variant, expected }) => {
    const launches = { count: 0 }
    const fixture = await createPlanValidationFixture(
      variant,
      acceptanceFactory({
        browser,
        html: await Bun.file(
          new URL(
            '../../../../../apps/example/acceptance/index.html',
            import.meta.url,
          ),
        ).text(),
        compilerTarget: 'original',
        launches,
      }),
    )
    const loaded = await fixture.store.readRevision(fixture.edited.revisionId)
    if (!loaded.ok || !loaded.value)
      throw new Error('The edited revision must exist')
    const revision = loaded.value
    const cacheBefore = await fixture.cache.coordination.readCurrent(
      fixture.key,
    )
    const metadataBefore = await fixture.cache.inspect()
    try {
      const reviewed = await fixture.validationService.review({
        revisionId: revision.id,
        rationale:
          'The repaired checkout target preserves the Specification intent.',
        evidenceRunIds: [],
      })
      if (!reviewed.ok) throw new Error(reviewed.message)
      const request = {
        revisionId: revision.id,
        reviewId: reviewed.value.reviewId,
        resetConfirmed: true as const,
      }
      const started = await fixture.validationService.start(request, {})
      const completed = await started.done
      const saved = completed.manifest.results[0]
      if (!saved) throw new Error('The validation must persist its result')
      const attempt = finalScenarioAttempt(saved)
      expect(attempt).toMatchObject({
        state: expected,
        executionMode: 'replay',
        inferenceCount: 0,
        planUse: { revisionId: revision.id, purpose: 'validation' },
      })
      expect(attempt.cacheOutcome).toBeUndefined()
      expect(launches.count).toBe(1)
      expect(completed.manifest.schemaVersion).toBe(3)
      const persisted = await openTestRunStore({ root: fixture.root }).open(
        started.id,
      )
      const events = await persisted.events()
      expect(
        events.find((event) => event.type === 'scenario-started'),
      ).toMatchObject({
        schemaVersion: 3,
        planUse: attempt.planUse,
      })
      expect(
        events.filter((event) =>
          [
            'cache-hit',
            'cache-miss',
            'cache-refresh',
            'replay-diverged',
            'adaptive-fallback-started',
            'cache-written',
            'cache-uncacheable',
          ].includes(event.type),
        ),
      ).toEqual([])
      if (expected === 'passed') {
        expect(attempt.steps).toHaveLength(9)
        expect(attempt.steps.every((step) => step.state === 'passed')).toBe(
          true,
        )
      } else {
        expect(
          attempt.steps.find((step) => step.state === 'failed'),
        ).toMatchObject({
          step: {
            text: 'the order summary shows one backpack with a total of $29.99',
          },
          message: expect.stringContaining('$39.99'),
        })
      }
      const status = await fixture.validationService.status(request)
      expect(status).toMatchObject(
        expected === 'passed'
          ? {
              ok: true,
              value: {
                state: 'validated',
                runId: started.id,
                receipt: {
                  revisionId: revision.id,
                  result: 'passed',
                  inferenceCount: 0,
                },
              },
            }
          : { ok: true, value: { state: 'failed', runId: started.id } },
      )
      if (expected === 'passed') {
        const execution = fixture.config.execution
        fixture.config.execution = { stepTimeoutMs: 1234 }
        expect(await fixture.validationService.status(request)).toEqual({
          ok: true,
          value: { state: 'draft' },
        })
        fixture.config.execution = execution
        expect(await fixture.validationService.status(request)).toEqual(status)
      }
      expect(await fixture.cache.coordination.readCurrent(fixture.key)).toEqual(
        cacheBefore,
      )
      expect(await fixture.cache.inspect()).toEqual(metadataBefore)
      const history = await fixture.store.inspect(revision.scope)
      expect(history.ok && history.value.selection).toEqual({
        state: 'available',
        record: fixture.selection,
      })
    } finally {
      fixture.dispose()
      await rm(fixture.root, { recursive: true, force: true })
    }
  },
  60_000,
)

test('records cancellation without issuing a receipt', async () => {
  const launches = { count: 0 }
  const fixture = await createPlanValidationFixture(
    'changed-target',
    acceptanceFactory({
      browser,
      html: await Bun.file(
        new URL(
          '../../../../../apps/example/acceptance/index.html',
          import.meta.url,
        ),
      ).text(),
      compilerTarget: 'original',
      launches,
    }),
  )
  try {
    const cacheBefore = await fixture.cache.coordination.readCurrent(
      fixture.key,
    )
    const metadataBefore = await fixture.cache.inspect()
    const selectionBefore = await fixture.store.inspect(fixture.captured.scope)
    const reviewed = await fixture.validationService.review({
      revisionId: fixture.edited.revisionId,
      rationale:
        'The repaired checkout target preserves the Specification intent.',
      evidenceRunIds: [],
    })
    if (!reviewed.ok) throw new Error(reviewed.message)
    const controller = new AbortController()
    controller.abort()
    const request = {
      revisionId: fixture.edited.revisionId,
      reviewId: reviewed.value.reviewId,
      resetConfirmed: true as const,
    }
    const started = await fixture.validationService.start(request, {
      signal: controller.signal,
    })
    await started.done
    expect(await fixture.validationService.status(request)).toEqual({
      ok: true,
      value: { state: 'cancelled', runId: started.id },
    })
    expect(launches.count).toBe(0)
    expect(await fixture.cache.coordination.readCurrent(fixture.key)).toEqual(
      cacheBefore,
    )
    expect(await fixture.cache.inspect()).toEqual(metadataBefore)
    const selectionAfter = await fixture.store.inspect(fixture.captured.scope)
    expect(selectionAfter.ok && selectionAfter.value.selection).toEqual(
      selectionBefore.ok && selectionBefore.value.selection,
    )
  } finally {
    fixture.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
}, 60_000)

test('requires a new review after saving another locator revision', async () => {
  const launches = { count: 0 }
  const fixture = await createPlanValidationFixture(
    'changed-target',
    acceptanceFactory({
      browser,
      html: await Bun.file(
        new URL(
          '../../../../../apps/example/acceptance/index.html',
          import.meta.url,
        ),
      ).text(),
      compilerTarget: 'original',
      launches,
    }),
  )
  try {
    const cacheBefore = await fixture.cache.inspect()
    const selectionBefore = await fixture.store.inspect(fixture.captured.scope)
    const reviewed = await fixture.validationService.review({
      revisionId: fixture.edited.revisionId,
      rationale:
        'The repaired checkout target preserves the Specification intent.',
      evidenceRunIds: [],
    })
    if (!reviewed.ok) throw new Error(reviewed.message)
    const validatedRequest = {
      revisionId: fixture.edited.revisionId,
      reviewId: reviewed.value.reviewId,
      resetConfirmed: true as const,
    }
    const validation = await fixture.validationService.start(
      validatedRequest,
      {},
    )
    await validation.done
    expect(
      await fixture.validationService.status(validatedRequest),
    ).toMatchObject({
      ok: true,
      value: { state: 'validated' },
    })

    const parent = await fixture.store.readRevision(fixture.edited.revisionId)
    if (!parent.ok || !parent.value)
      throw new Error('The repaired revision must exist')
    const parentPayload = parseWebExecutionCachePayload(
      z.json().parse(parent.value.adapterPayload),
      parent.value.requiredVariables,
    )
    const instruction = parentPayload?.steps[5]?.instructions[0]
    if (!instruction) throw new Error('The checkout instruction must exist')
    const next = await fixture.service.edit({
      ...fixture.request,
      parentRevisionId: parent.value.id,
      step: { scenarioRevision: fixture.key.scenarioRevision, index: 5 },
      instructionIndex: 0,
      expectedInstructionDigest: planDigest(instruction),
      locator: { selector: { segments: [{ literal: '#review-order-v2' }] } },
    })
    if (!next.ok) throw new Error(next.message)
    expect(
      await fixture.validationService.status({
        revisionId: next.value.revisionId,
        reviewId: reviewed.value.reviewId,
      }),
    ).toMatchObject({ ok: false, reason: 'specification-review-required' })
    expect(await fixture.cache.inspect()).toEqual(cacheBefore)
    const selectionAfter = await fixture.store.inspect(fixture.captured.scope)
    expect(selectionAfter.ok && selectionAfter.value.selection).toEqual(
      selectionBefore.ok && selectionBefore.value.selection,
    )
  } finally {
    fixture.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
}, 60_000)

test('cancels an in-flight Chrome validation without issuing a receipt', async () => {
  const launches = { count: 0 }
  const fixture = await createPlanValidationFixture(
    'changed-target',
    acceptanceFactory({
      browser,
      html: await Bun.file(
        new URL(
          '../../../../../apps/example/acceptance/index.html',
          import.meta.url,
        ),
      ).text(),
      compilerTarget: 'original',
      launches,
    }),
  )
  try {
    const cacheBefore = await fixture.cache.inspect()
    const selectionBefore = await fixture.store.inspect(fixture.captured.scope)
    const reviewed = await fixture.validationService.review({
      revisionId: fixture.edited.revisionId,
      rationale:
        'The repaired checkout target preserves the Specification intent.',
      evidenceRunIds: [],
    })
    if (!reviewed.ok) throw new Error(reviewed.message)
    const request = {
      revisionId: fixture.edited.revisionId,
      reviewId: reviewed.value.reviewId,
      resetConfirmed: true as const,
    }
    const controller = new AbortController()
    const started = await fixture.validationService.start(request, {
      signal: controller.signal,
      onEvent(event) {
        if (event.type === 'step-finished') controller.abort()
      },
    })
    await started.done
    expect(await fixture.validationService.status(request)).toEqual({
      ok: true,
      value: { state: 'cancelled', runId: started.id },
    })
    expect(launches.count).toBe(1)
    expect(await fixture.cache.inspect()).toEqual(cacheBefore)
    const selectionAfter = await fixture.store.inspect(fixture.captured.scope)
    expect(selectionAfter.ok && selectionAfter.value.selection).toEqual(
      selectionBefore.ok && selectionBefore.value.selection,
    )
  } finally {
    fixture.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
}, 60_000)

test('records a real replay timeout without issuing a receipt or changing cache state', async () => {
  const launches = { count: 0 }
  const delay = { ms: 0 }
  const baseFactory = acceptanceFactory({
    browser,
    html: await Bun.file(
      new URL(
        '../../../../../apps/example/acceptance/index.html',
        import.meta.url,
      ),
    ).text(),
    compilerTarget: 'original',
    launches,
  })
  const fixture = await createPlanValidationFixture(
    'changed-target',
    delayedInstructionFactory(baseFactory, () => delay.ms, 'click'),
    { stepTimeoutMs: 250 },
  )
  try {
    const cacheBefore = await fixture.cache.inspect()
    const selectionBefore = await fixture.store.inspect(fixture.captured.scope)
    const reviewed = await fixture.validationService.review({
      revisionId: fixture.edited.revisionId,
      rationale:
        'The repaired checkout target preserves the Specification intent.',
      evidenceRunIds: [],
    })
    if (!reviewed.ok) throw new Error(reviewed.message)
    const request = {
      revisionId: fixture.edited.revisionId,
      reviewId: reviewed.value.reviewId,
      resetConfirmed: true as const,
    }
    const passed = await fixture.validationService.start(request, {})
    await passed.done
    expect(await fixture.validationService.status(request)).toMatchObject({
      ok: true,
      value: { state: 'validated', runId: passed.id },
    })
    delay.ms = 500
    const started = await fixture.validationService.start(request, {})
    const completed = await started.done
    const result = completed.manifest.results[0]
    if (!result)
      throw new Error('The timeout validation must persist its result')
    expect(finalScenarioAttempt(result)).toMatchObject({
      state: 'infrastructure-error',
      executionMode: 'replay',
      inferenceCount: 0,
    })
    expect(await fixture.validationService.status(request)).toEqual({
      ok: true,
      value: { state: 'failed', runId: started.id },
    })
    expect(await fixture.cache.inspect()).toEqual(cacheBefore)
    const selectionAfter = await fixture.store.inspect(fixture.captured.scope)
    expect(selectionAfter.ok && selectionAfter.value.selection).toEqual(
      selectionBefore.ok && selectionBefore.value.selection,
    )
  } finally {
    fixture.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
}, 60_000)
