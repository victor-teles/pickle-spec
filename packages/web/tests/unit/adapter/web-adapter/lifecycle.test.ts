import { runScenario } from '@pickle-spec/runner'
import { resolveScenarioId } from '@pickle-spec/spec'
import { describe, expect, test, vi } from 'vitest'
import {
  createWebAdapter,
  type WebAutomationFactory,
  type WebLiveViewportUpdate,
} from '../../../../index'
import type { WebClientContext } from '../../../../src/adapter/automation/web-automation'
import { requiredValue } from '../../../../src/required-value'
import { factoryFor, scenario, specification, stubAutomation } from './fixtures'

describe('createWebAdapter lifecycle', () => {
  test('pools browser processes across consecutive logical sessions', async () => {
    const launch = vi.fn(async () => ({
      openContext: vi.fn(async () => stubAutomation()),
      close: vi.fn(async () => {}),
    }))
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      { launch },
    )

    const first = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })
    await first.close()
    const second = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario: { ...scenario, name: 'Second search' },
    })
    await second.close()
    await adapter.dispose?.()

    expect(launch).toHaveBeenCalledTimes(1)
  })

  test('forwards live viewport updates with canonical Scenario target identity', async () => {
    const updates: WebLiveViewportUpdate[] = []
    const launch: WebAutomationFactory['launch'] = vi.fn(async () => ({
      async openContext(context: WebClientContext) {
        context.onLiveViewport?.({
          kind: 'frame',
          data: 'latest-frame',
          mimeType: 'image/jpeg',
        })
        return stubAutomation({
          async close() {
            context.onLiveViewport?.({ kind: 'closed' })
          },
        })
      },
      async close() {},
    }))
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      { launch },
      { onLiveViewport: (update) => updates.push(update) },
    )

    const session = await adapter.openSession({
      executionTargetProfile: { id: 'attached-chrome' },
      specification,
      scenario: { ...scenario, examplesRowId: 'row-card' },
    })
    await session.close()
    await adapter.dispose?.()

    const target = {
      scenarioId: resolveScenarioId(
        specification.source.uri,
        specification.name,
        scenario.name,
        scenario.tags,
      ),
      examplesRowId: 'row-card',
      profileId: 'attached-chrome',
    }
    expect(updates).toEqual([
      {
        kind: 'frame',
        data: 'latest-frame',
        mimeType: 'image/jpeg',
        target,
      },
      { kind: 'closed', target },
    ])
  })

  test('surfaces isolation verification failure when opening a logical session', async () => {
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(
        stubAutomation({
          async readIsolationState() {
            return { cookieCount: 2, storageKeyCount: 0 }
          },
        }),
      ),
    )

    await expect(
      adapter.openSession({
        executionTargetProfile: { id: 'web' },
        specification,
        scenario,
      }),
    ).rejects.toThrow('Logical session isolation verification failed')
  })

  test('closes automation and retires the browser process on abort', async () => {
    let closeStarted = false
    let closeFinished = false
    const browserClosed = Promise.withResolvers<void>()
    const launch = vi.fn(async () => ({
      openContext: vi.fn(async () =>
        stubAutomation({
          async navigate(_url, signal) {
            await new Promise((_resolve, reject) => {
              signal?.addEventListener(
                'abort',
                () =>
                  reject(new DOMException('Scenario cancelled', 'AbortError')),
                { once: true },
              )
            })
          },
          async close() {
            closeStarted = true
            await browserClosed.promise
            closeFinished = true
          },
        }),
      ),
      close: vi.fn(async () => browserClosed.resolve()),
    }))
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      { launch },
    )
    const controller = new AbortController()
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
      signal: controller.signal,
    })
    const execution = session.executeStep(
      requiredValue(scenario.steps[0]),
      controller.signal,
    )
    controller.abort()
    await expect(execution).rejects.toThrow('Scenario cancelled')
    const closeOutcome = await Promise.race([
      session.close().then(() => 'closed'),
      Bun.sleep(250).then(() => 'still-pending'),
    ])
    browserClosed.resolve()
    await session.close()
    expect(closeStarted).toBe(true)
    expect(closeFinished).toBe(true)
    expect(closeOutcome).toBe('closed')

    const reused = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario: { ...scenario, name: 'Reuse after abort' },
    })
    await reused.close()
    await adapter.dispose?.()
    expect(launch).toHaveBeenCalledTimes(2)
  })

  test('finishes a cancelled runner scenario when browser shutdown unblocks automation cleanup', async () => {
    const stepStarted = Promise.withResolvers<void>()
    const browserClosed = Promise.withResolvers<void>()
    const closeBrowser = vi.fn(async () => browserClosed.resolve())
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      {
        launch: vi.fn(async () => ({
          openContext: vi.fn(async () =>
            stubAutomation({
              async navigate(_url, signal) {
                stepStarted.resolve()
                await new Promise((_resolve, reject) => {
                  signal?.addEventListener(
                    'abort',
                    () =>
                      reject(
                        new DOMException('Scenario cancelled', 'AbortError'),
                      ),
                    { once: true },
                  )
                })
              },
              async close() {
                await browserClosed.promise
              },
            }),
          ),
          close: closeBrowser,
        })),
      },
    )
    const controller = new AbortController()
    const running = runScenario({
      adapter,
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
      signal: controller.signal,
    })

    await stepStarted.promise
    controller.abort()
    const outcome = await Promise.race([
      running.then((run) => ({ status: 'finished' as const, run })),
      Bun.sleep(250).then(() => ({ status: 'still-pending' as const })),
    ])
    if (outcome.status === 'still-pending') {
      browserClosed.resolve()
      await running
      await adapter.dispose?.()
      throw new Error('Cancelled runner scenario did not finish promptly')
    }

    await adapter.dispose?.()
    expect(outcome.run.result.state).toBe('cancelled')
    expect(outcome.run.events.at(-1)?.type).toBe('scenario-finished')
    expect(closeBrowser).toHaveBeenCalledTimes(1)
  })
})
