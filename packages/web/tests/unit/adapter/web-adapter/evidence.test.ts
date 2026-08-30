import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Scenario } from '@pickle-spec/spec'
import { afterAll, describe, expect, test } from 'vitest'
import { createWebAdapter } from '../../../../index'
import { requiredValue } from '../../../../src/required-value'
import { factoryFor, scenario, specification, stubAutomation } from './fixtures'

describe('createWebAdapter evidence', () => {
  const artifactDirectories: string[] = []

  afterAll(async () => {
    await Promise.all(
      artifactDirectories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })

  test('emits a Pickle-native trace and Diagnostic entries from browser activity', async () => {
    let consumeCalls = 0
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(
        stubAutomation({
          async observe() {
            return [
              {
                description: 'Click pay on chrome',
                handle: { selector: '#pay' },
              },
            ]
          },
          async act() {
            return { success: true }
          },
          async verify() {
            return {
              meetsExpectation: false,
              actualState: 'Payment was declined',
            }
          },
          consumeEvidence() {
            consumeCalls += 1
            if (consumeCalls < 3) {
              return { diagnostics: [], activity: [] }
            }
            return {
              diagnostics: [
                {
                  occurredAt: '2026-08-23T12:00:00.004Z',
                  level: 'error',
                  origin: 'console',
                  message: 'Payment was declined',
                },
                {
                  occurredAt: '2026-08-23T12:00:00.004Z',
                  level: 'error',
                  origin: 'network',
                  message: 'POST https://example.test/pay failed: 402',
                },
              ],
              activity: [
                {
                  occurredAt: '2026-08-23T12:00:00.003Z',
                  description: 'Navigate https://example.test/checkout',
                },
              ],
            }
          },
        }),
      ),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })

    await session.executeStep(requiredValue(scenario.steps[0]))
    await session.executeStep(requiredValue(scenario.steps[1]))
    const outcome = await session.executeStep(requiredValue(scenario.steps[2]))
    await session.close()

    expect(outcome.state).toBe('failed')
    expect(outcome.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'resolved-action',
          description: 'Click pay on chrome',
        }),
        expect.objectContaining({
          kind: 'browser-activity',
          description: 'Navigate https://example.test/checkout',
        }),
      ]),
    )
    expect(outcome.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: 'console',
          message: 'Payment was declined',
        }),
        expect.objectContaining({
          origin: 'network',
          message: 'POST https://example.test/pay failed: 402',
        }),
        expect.objectContaining({
          origin: 'adapter',
          message:
            'Expected: "pickle results are visible" | Actual: Payment was declined',
        }),
      ]),
    )
    expect(outcome.evidenceAvailability).toEqual(
      expect.arrayContaining([
        { kind: 'diagnostics', state: 'available' },
        { kind: 'trace', state: 'available' },
      ]),
    )
  })

  test('isolates screenshot paths for concurrent Scenario Outline rows', async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'pickle-web-outline-artifacts-'),
    )
    artifactDirectories.push(artifactDirectory)
    let screenshotIndex = 0
    const adapter = createWebAdapter(
      {
        baseUrl: 'https://example.test',
        screenshots: { mode: 'on-step', outputDir: artifactDirectory },
      },
      factoryFor(
        stubAutomation({
          async screenshot() {
            const currentScreenshot = ++screenshotIndex
            await Bun.sleep(5)
            return new TextEncoder().encode(`row-${currentScreenshot}`)
          },
        }),
      ),
    )
    const outlineRow = (examplesRowId: string): Scenario => ({
      ...scenario,
      id: 'shared-outline-scenario',
      examplesId: 'search-examples',
      examplesRowId,
    })
    const first = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario: outlineRow('row-one'),
    })
    const second = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario: outlineRow('row-two'),
    })

    const [firstResult, secondResult] = await Promise.all([
      first.executeStep(requiredValue(scenario.steps[0])),
      second.executeStep(requiredValue(scenario.steps[0])),
    ])
    await Promise.all([first.close(), second.close()])
    await adapter.dispose?.()

    const firstPath = firstResult.artifacts?.[0]?.path
    const secondPath = secondResult.artifacts?.[0]?.path
    expect(firstPath).toBeDefined()
    expect(secondPath).toBeDefined()
    expect(firstPath).not.toBe(secondPath)
    expect(firstPath).toMatch(/examples-row-[a-f0-9]{16}/)
    expect(secondPath).toMatch(/examples-row-[a-f0-9]{16}/)
    expect(await Bun.file(requiredValue(firstPath)).text()).not.toBe(
      await Bun.file(requiredValue(secondPath)).text(),
    )
  })
})
