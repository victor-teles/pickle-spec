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

  test('rejects an unsupported Stagehand model before opening a logical session', () => {
    const open = mock(async () => {
      throw new Error('logical session must not start')
    })

    expect(() =>
      createWebAdapter(
        {
          baseUrl: 'https://example.test',
          browser: { modelName: 'google/gemini-3.7-flash' },
        },
        { open },
      ),
    ).toThrow(
      'web.browser.modelName "google/gemini-3.7-flash" is not a Stagehand-supported model',
    )
    expect(open).not.toHaveBeenCalled()
  })

  test('accepts a Stagehand-supported model name', () => {
    expect(() =>
      createWebAdapter({
        baseUrl: 'https://example.test',
        browser: { modelName: 'google/gemini-3.6-flash' },
      }),
    ).not.toThrow()
  })

  test('forwards GOOGLE_API_KEY to the automation factory for a Google model', async () => {
    const names = [
      'GOOGLE_API_KEY',
      'GOOGLE_GENERATIVE_AI_API_KEY',
      'GEMINI_API_KEY',
    ]
    const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    )
    for (const name of names) delete process.env[name]
    process.env.GOOGLE_API_KEY = 'test-google-key'
    const open = mock(async () => ({
      async navigate() {},
      async observe() {
        return []
      },
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
    }))
    try {
      const adapter = createWebAdapter(
        {
          baseUrl: 'https://example.test',
          browser: { modelName: 'google/gemini-3.6-flash' },
        },
        { open },
      )
      const session = await adapter.openSession({
        executionTargetProfile: { id: 'web' },
        specification,
        scenario,
      })
      await session.close()
    } finally {
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name]
        else process.env[name] = previous[name]
      }
    }

    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        browser: expect.objectContaining({ modelApiKey: 'test-google-key' }),
      }),
    )
  })

  test('rejects a local Stagehand session without a provider API key before launching a browser', async () => {
    const previous = {
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    }
    delete process.env.GOOGLE_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    delete process.env.GEMINI_API_KEY
    const adapter = createWebAdapter({
      baseUrl: 'https://example.test',
      browser: { modelName: 'google/gemini-3.6-flash' },
    })
    try {
      await expect(
        adapter.openSession({
          executionTargetProfile: { id: 'web' },
          specification,
          scenario,
        }),
      ).rejects.toThrow(
        'Model inference requires a provider API key or a Browserbase session',
      )
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })
})
