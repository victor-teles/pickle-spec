import { afterAll, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Scenario, Specification } from '@pickle-spec/spec'
import {
  createWebAdapter,
  type WebAutomation,
  type WebAutomationFactory,
} from '../index'

const scenario: Scenario = {
  name: 'Search for pickles',
  tags: ['@web'],
  steps: [
    { keyword: 'Given', text: 'I navigate to /search', type: 'context' },
    { keyword: 'When', text: 'I search for pickles', type: 'action' },
    { keyword: 'Then', text: 'pickle results are visible', type: 'outcome' },
  ],
}

const specification: Specification = {
  name: 'Search',
  source: { uri: 'features/search.feature', language: 'en' },
  tags: ['@web'],
  scenarios: [scenario],
}

describe('createWebAdapter', () => {
  const artifactDirectories: string[] = []

  afterAll(async () => {
    await Promise.all(
      artifactDirectories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })

  test('translates web automation into resolved actions, runner states, and screenshot artifacts', async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'pickle-web-artifacts-'),
    )
    artifactDirectories.push(artifactDirectory)
    const navigate = mock(async () => {})
    const observe = mock(async () => [
      { description: 'Fill the search field', handle: { selector: '#search' } },
    ])
    const act = mock(async () => ({ success: true }))
    const verify = mock(async () => ({
      meetsExpectation: false,
      actualState: 'No results were shown',
    }))
    const close = mock(async () => {})
    const automation: WebAutomation = {
      navigate,
      observe,
      act,
      verify,
      async screenshot() {
        return new Uint8Array([137, 80, 78, 71])
      },
      close,
    }
    const factory: WebAutomationFactory = {
      open: mock(async () => automation),
    }
    const adapter = createWebAdapter(
      {
        baseUrl: 'https://example.test',
        screenshots: { mode: 'on-step', outputDir: artifactDirectory },
      },
      factory,
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })

    const navigation = await session.executeStep(scenario.steps[0]!)
    const action = await session.executeStep(scenario.steps[1]!)
    const outcome = await session.executeStep(scenario.steps[2]!)
    await session.close()

    expect(navigate).toHaveBeenCalledWith(
      'https://example.test/search',
      undefined,
    )
    expect(action).toMatchObject({
      state: 'passed',
      resolvedActions: [{ description: 'Fill the search field' }],
      artifacts: [{ kind: 'screenshot', mediaType: 'image/png' }],
    })
    expect(outcome).toMatchObject({
      state: 'failed',
      message:
        'Expected: "pickle results are visible" | Actual: No results were shown',
      artifacts: [{ kind: 'screenshot', mediaType: 'image/png' }],
    })
    expect(navigation.artifacts?.[0]?.path).toContain(artifactDirectory)
    expect(await Bun.file(navigation.artifacts![0]!.path).exists()).toBe(true)
    expect(observe).toHaveBeenCalledTimes(1)
    expect(act).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('gives explicit navigation precedence for an action step', async () => {
    const navigate = mock(async () => {})
    const observe = mock(async () => [])
    const automation: WebAutomation = {
      navigate,
      observe,
      async act() {
        return { success: true }
      },
      async verify() {
        return { meetsExpectation: true, actualState: 'Ready' }
      },
      async screenshot() {
        return new Uint8Array()
      },
      async close() {},
    }
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      {
        async open() {
          return automation
        },
      },
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })

    const result = await session.executeStep({
      keyword: 'When',
      text: 'I navigate to /checkout',
      type: 'action',
    })
    await session.close()

    expect(result).toMatchObject({
      state: 'passed',
      resolvedActions: [
        { description: 'Navigate to https://example.test/checkout' },
      ],
    })
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(
      'https://example.test/checkout',
      undefined,
    )
    expect(observe).not.toHaveBeenCalled()
  })
})
