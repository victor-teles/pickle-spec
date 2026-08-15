import { beforeEach, describe, expect, mock, test } from 'bun:test'

const state = {
  createStagehandCalls: 0,
  closeStagehandCalls: 0,
  resetBrowserStateCalls: 0,
  captureScreenshotCalls: 0,
  startServerCalls: 0,
  stopServerCalls: 0,
  scenarioStarts: [] as string[],
  scenarioIgnored: [] as string[],
  stagehands: [] as any[],
  stepInfoMap: new Map<string, { keyword: string; type: 'Context' | 'Action' | 'Outcome' }>(),
  throwOnCreateStagehand: false,
  throwOnStartServer: false,
}

function makeStep(id: string, text: string) {
  return {
    id,
    text,
    astNodeIds: [`${id}-ast`],
  }
}

function makePickle(name: string, steps: ReturnType<typeof makeStep>[], tags: string[] = []) {
  return {
    id: `${name}-id`,
    name,
    language: 'en',
    uri: `file:///tmp/${name}.feature`,
    steps,
    tags: tags.map((tag, index) => ({
      id: `${name}-tag-${index}`,
      name: tag,
      astNodeId: `${name}-tag-ast-${index}`,
    })),
    astNodeIds: [`${name}-ast`],
  }
}

function makeFeature(name: string, pickles: ReturnType<typeof makePickle>[]) {
  return {
    filePath: `/tmp/${name}.feature`,
    featureName: name,
    document: {} as any,
    pickles,
  }
}

function createFakeStagehand(options: {
  observeResults?: Array<{ success: boolean; error?: string }>
  observeActions?: Array<{ description: string }>
  emptyObserve?: boolean
  verificationPass?: boolean
  actDelayMs?: number
  extractDelayMs?: number
  onAct?: () => void
} = {}) {
  const actResults = [...(options.observeResults ?? [{ success: true }])]
  const page = {}

  return {
    browser: {
      context: {
        activePage: async () => page,
        pages: async () => [page],
        clearCookies: async () => {},
      },
      close: mock(async () => {}),
    },
    observe: mock(async () => {
      if (options.emptyObserve) {
        return { data: [] }
      }
      return {
        data: options.observeActions ?? [{ description: 'mock action' }],
      }
    }),
    act: mock(async () => {
      options.onAct?.()
      if (options.actDelayMs) {
        await Bun.sleep(options.actDelayMs)
      }
      const next = actResults.shift() ?? { success: true }
      return {
        data: {
          success: next.success,
          message: next.error ?? (next.success ? 'ok' : 'Action failed'),
          actionDescription: 'mock',
          actions: [],
        },
      }
    }),
    extract: mock(async () => {
      if (options.extractDelayMs) {
        await Bun.sleep(options.extractDelayMs)
      }
      return {
        data: {
          meetsExpectation: options.verificationPass ?? true,
          actualState: options.verificationPass === false ? 'missing element' : 'ok',
        },
      }
    }),
    close: mock(async () => {}),
  }
}

await mock.module('./browser-lifecycle', () => ({
  createStagehandAndNavigate: async () => {
    state.createStagehandCalls++
    if (state.throwOnCreateStagehand) {
      throw new Error('browser failed to launch')
    }
    const stagehand = state.stagehands.shift()
    if (!stagehand) throw new Error('missing stagehand')
    return stagehand
  },
  resetBrowserState: async () => {
    state.resetBrowserStateCalls++
  },
  closeStagehand: async () => {
    state.closeStagehandCalls++
  },
  getActivePage: async (stagehand: any) => {
    return await stagehand.browser.context.activePage()
  },
}))

await mock.module('./server', () => ({
  startServer: async () => {
    state.startServerCalls++
    if (state.throwOnStartServer) {
      throw new Error('server failed to start')
    }
    return {
      process: {} as any,
      reused: false,
      url: 'http://localhost:3000',
      stop: () => {},
    }
  },
  stopServer: () => {
    state.stopServerCalls++
  },
}))

await mock.module('./reporter', () => ({
  reportScenarioIgnored: (name: string) => {
    state.scenarioIgnored.push(name)
  },
  reportFeatureStart: () => {},
  reportServerReady: () => {},
  reportServerReused: () => {},
  reportServerStarting: () => {},
  reportVerbose: () => {},
  suppressThirdPartyLogs: () => () => {},
  createDirectReporter: () => ({
    stepStart: () => {},
    stepResult: () => {},
    scenarioStart: (name: string) => {
      state.scenarioStarts.push(name)
    },
    scenarioIgnored: (name: string) => {
      state.scenarioIgnored.push(name)
    },
    verbose: () => {},
    verboseLog: () => {},
    flush: () => {},
  }),
  createBufferedReporter: () => ({
    stepStart: () => {},
    stepResult: () => {},
    scenarioStart: (name: string) => {
      state.scenarioStarts.push(name)
    },
    scenarioIgnored: (name: string) => {
      state.scenarioIgnored.push(name)
    },
    verbose: () => {},
    verboseLog: () => {},
    flush: () => {},
  }),
  startParallelProgress: () => ({
    update: () => {},
    stop: () => {},
  }),
}))

await mock.module('./screenshots', () => ({
  captureScreenshot: async () => {
    state.captureScreenshotCalls++
    return undefined
  },
  sanitize: (value: string) => value,
}))

await mock.module('./trace', () => ({
  startStepTrace: async () => ({
    stop: async () => [],
    saveFrames: async () => [],
  }),
}))

await mock.module('./step-utils', () => ({
  buildStepInfoMap: () => state.stepInfoMap,
  buildStepPrompt: (step: { text: string }) => step.text,
  VerificationSchema: {},
  NAVIGATION_PATTERN: /navigate to ["']?(.+?)["']?$/i,
}))

await mock.module('./dom-optimization', () => ({
  navigateAndSimplify: async () => {},
}))

const { runFeatures, cancelRun } = await import('./runner')
const cancellation = await import('./cancellation')

describe('runFeatures', () => {
  beforeEach(() => {
    state.createStagehandCalls = 0
    state.closeStagehandCalls = 0
    state.resetBrowserStateCalls = 0
    state.captureScreenshotCalls = 0
    state.startServerCalls = 0
    state.stopServerCalls = 0
    state.scenarioStarts = []
    state.scenarioIgnored = []
    state.stagehands = []
    state.stepInfoMap = new Map()
    state.throwOnCreateStagehand = false
    state.throwOnStartServer = false
  })

  test('runs serial scenarios successfully', async () => {
    const first = makeStep('step-1', 'I navigate to "https://example.com"')
    const second = makeStep('step-2', 'I should see "Example Domain"')
    state.stepInfoMap.set(first.astNodeIds[0]!, { keyword: 'Given ', type: 'Context' })
    state.stepInfoMap.set(second.astNodeIds[0]!, { keyword: 'Then ', type: 'Outcome' })
    state.stagehands.push(createFakeStagehand({ verificationPass: true }))

    const result = await runFeatures([
      makeFeature('Serial Feature', [
        makePickle('Happy path', [first, second]),
      ]),
    ], {
      browser: {
        env: 'LOCAL',
        modelName: 'custom-provider/model-1',
        headless: true,
      },
      concurrency: 1,
    }, {
      verbose: false,
    })

    expect(result.passed).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.features[0]!.scenarios[0]!.steps.map(step => step.status)).toEqual(['passed', 'passed'])
    expect(state.createStagehandCalls).toBe(1)
    expect(state.closeStagehandCalls).toBe(1)
  })

  test('marks remaining steps as skipped after the first failure', async () => {
    const first = makeStep('step-1', 'I click the failing button')
    const second = makeStep('step-2', 'I click the next button')
    const third = makeStep('step-3', 'I should see success')
    state.stepInfoMap.set(first.astNodeIds[0]!, { keyword: 'When ', type: 'Action' })
    state.stepInfoMap.set(second.astNodeIds[0]!, { keyword: 'And ', type: 'Action' })
    state.stepInfoMap.set(third.astNodeIds[0]!, { keyword: 'Then ', type: 'Outcome' })
    state.stagehands.push(createFakeStagehand({
      observeResults: [{ success: false, error: 'Element not found' }],
    }))

    const result = await runFeatures([
      makeFeature('Failure Feature', [
        makePickle('Stops after failure', [first, second, third]),
      ]),
    ], {
      browser: {
        env: 'LOCAL',
        modelName: 'custom-provider/model-1',
        headless: true,
      },
      concurrency: 1,
    }, {
      verbose: false,
    })

    expect(result.failed).toBe(1)
    expect(result.features[0]!.scenarios[0]!.steps.map(step => step.status)).toEqual(['failed', 'skipped', 'skipped'])
  })

  test('skips ignored scenarios without launching a browser for them', async () => {
    const runnableStep = makeStep('step-1', 'I should see success')
    state.stepInfoMap.set(runnableStep.astNodeIds[0]!, { keyword: 'Then ', type: 'Outcome' })
    state.stagehands.push(createFakeStagehand({ verificationPass: true }))

    const result = await runFeatures([
      makeFeature('Ignored Feature', [
        makePickle('Ignored scenario', [runnableStep], ['@ignore']),
        makePickle('Runnable scenario', [runnableStep]),
      ]),
    ], {
      browser: {
        env: 'LOCAL',
        modelName: 'custom-provider/model-1',
        headless: true,
      },
      concurrency: 1,
    }, {
      verbose: false,
    })

    expect(result.skipped).toBe(1)
    expect(result.passed).toBe(1)
    expect(state.createStagehandCalls).toBe(1)
    expect(state.scenarioIgnored).toContain('Ignored scenario')
  })

  test('stops the managed server when browser startup fails', async () => {
    state.throwOnCreateStagehand = true

    const result = await runFeatures([
      makeFeature('Server Feature', [
        makePickle('Launch fails', [makeStep('step-1', 'I should see success')]),
      ]),
    ], {
      server: {
        command: 'bun run dev',
        url: 'http://localhost:3000',
      },
      browser: {
        env: 'LOCAL',
        modelName: 'custom-provider/model-1',
        headless: true,
      },
      concurrency: 1,
    }, {
      verbose: false,
    })

    expect(state.startServerCalls).toBe(1)
    expect(state.stopServerCalls).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.features[0]!.scenarios[0]!.failureKind).toBe('infrastructure')
    expect(result.features[0]!.scenarios[0]!.error).toContain('browser failed to launch')
  })

  test('aggregates parallel scenario results', async () => {
    const passing = makeStep('step-1', 'I should see success')
    const failing = makeStep('step-2', 'I click the failing button')
    state.stepInfoMap.set(passing.astNodeIds[0]!, { keyword: 'Then ', type: 'Outcome' })
    state.stepInfoMap.set(failing.astNodeIds[0]!, { keyword: 'When ', type: 'Action' })
    state.stagehands.push(
      createFakeStagehand({ verificationPass: true }),
      createFakeStagehand({ observeResults: [{ success: false, error: 'Action failed' }] }),
    )

    const result = await runFeatures([
      makeFeature('Parallel Feature', [
        makePickle('Passes', [passing]),
        makePickle('Fails', [failing]),
      ]),
    ], {
      browser: {
        env: 'LOCAL',
        modelName: 'custom-provider/model-1',
        headless: true,
      },
      concurrency: 2,
    }, {
      verbose: false,
    })

    expect(result.passed).toBe(1)
    expect(result.failed).toBe(1)
    expect(state.createStagehandCalls).toBe(2)
    expect(state.closeStagehandCalls).toBe(2)
  })

  test('retries infrastructure failures and marks recovered scenarios as flaky', async () => {
    const step = makeStep('step-1', 'I click the failing button')
    state.stepInfoMap.set(step.astNodeIds[0]!, { keyword: 'When ', type: 'Action' })
    state.stagehands.push(
      createFakeStagehand({ observeResults: [{ success: false, error: 'Temporary failure' }] }),
      createFakeStagehand({ observeResults: [{ success: true }] }),
    )

    const result = await runFeatures([
      makeFeature('Retry Feature', [
        makePickle('Eventually passes', [step]),
      ]),
    ], {
      browser: {
        env: 'LOCAL',
        modelName: 'custom-provider/model-1',
        headless: true,
      },
      concurrency: 1,
      execution: {
        retries: 1,
        retryOn: 'infrastructure',
      },
    }, {
      verbose: false,
    })

    const scenario = result.features[0]!.scenarios[0]!
    expect(result.passed).toBe(1)
    expect(scenario.flaky).toBe(true)
    expect(scenario.attempts).toBe(2)
    expect(scenario.attemptResults?.map(attempt => attempt.status)).toEqual(['failed', 'passed'])
  })

  test('does not retry assertion failures', async () => {
    const step = makeStep('step-1', 'I should see success')
    state.stepInfoMap.set(step.astNodeIds[0]!, { keyword: 'Then ', type: 'Outcome' })
    state.stagehands.push(createFakeStagehand({ verificationPass: false }))

    const result = await runFeatures([
      makeFeature('Assertion Feature', [
        makePickle('Fails once', [step]),
      ]),
    ], {
      browser: {
        env: 'LOCAL',
        modelName: 'custom-provider/model-1',
        headless: true,
      },
      concurrency: 1,
      execution: {
        retries: 2,
        retryOn: 'infrastructure',
      },
    }, {
      verbose: false,
    })

    const scenario = result.features[0]!.scenarios[0]!
    expect(result.failed).toBe(1)
    expect(scenario.failureKind).toBe('assertion')
    expect(scenario.attempts).toBe(1)
    expect(state.createStagehandCalls).toBe(1)
  })

  test('classifies step timeouts as infrastructure failures', async () => {
    const step = makeStep('step-1', 'I click the slow button')
    state.stepInfoMap.set(step.astNodeIds[0]!, { keyword: 'When ', type: 'Action' })
    state.stagehands.push(createFakeStagehand({ actDelayMs: 20 }))

    const result = await runFeatures([
      makeFeature('Timeout Feature', [
        makePickle('Slow action', [step]),
      ]),
    ], {
      browser: {
        env: 'LOCAL',
        modelName: 'custom-provider/model-1',
        headless: true,
      },
      concurrency: 1,
      execution: {
        stepTimeoutMs: 1,
        retryOn: 'infrastructure',
      },
    }, {
      verbose: false,
    })

    const scenario = result.features[0]!.scenarios[0]!
    expect(scenario.failureKind).toBe('infrastructure')
    expect(scenario.error).toContain('Step timed out')
  })

  test('prevents a timed-out step from capturing artifacts after the result is final', async () => {
    const step = makeStep('step-1', 'I click the slow button')
    state.stepInfoMap.set(step.astNodeIds[0]!, { keyword: 'When ', type: 'Action' })
    state.stagehands.push(createFakeStagehand({ actDelayMs: 20 }))

    const result = await runFeatures([
      makeFeature('Timeout Isolation Feature', [
        makePickle('Slow action', [step]),
      ]),
    ], {
      browser: {
        env: 'LOCAL',
        modelName: 'custom-provider/model-1',
        headless: true,
      },
      screenshots: {
        mode: 'on-step',
      },
      concurrency: 1,
      execution: {
        stepTimeoutMs: 1,
        retryOn: 'infrastructure',
      },
    }, {
      verbose: false,
    })

    expect(result.features[0]!.scenarios[0]!.failureKind).toBe('infrastructure')
    expect(state.closeStagehandCalls).toBeGreaterThan(0)
    await Bun.sleep(30)
    expect(state.captureScreenshotCalls).toBe(0)
  })

  test('returns infrastructure failures when the managed server never starts', async () => {
    state.throwOnStartServer = true

    const result = await runFeatures([
      makeFeature('Server Feature', [
        makePickle('Launch fails', [makeStep('step-1', 'I should see success')]),
      ]),
    ], {
      server: {
        command: 'bun run dev',
        url: 'http://localhost:3000',
      },
      browser: {
        env: 'LOCAL',
        modelName: 'custom-provider/model-1',
        headless: true,
      },
      concurrency: 1,
    }, {
      verbose: false,
    })

    expect(result.failed).toBe(1)
    expect(result.features[0]!.scenarios[0]!.failureKind).toBe('infrastructure')
    expect(result.features[0]!.scenarios[0]!.error).toContain('server failed to start')
  })

  test('marks a running scenario as cancelled when the run is aborted mid-step', async () => {
    const step = makeStep('step-1', 'I click the slow button')
    state.stepInfoMap.set(step.astNodeIds[0]!, { keyword: 'When ', type: 'Action' })
    state.stagehands.push(createFakeStagehand({
      actDelayMs: 20,
      onAct: () => {
        queueMicrotask(() => cancelRun())
      },
    }))

    const result = await runFeatures([
      makeFeature('Cancellation Feature', [
        makePickle('Cancelled scenario', [step]),
      ]),
    ], {
      browser: {
        env: 'LOCAL',
        modelName: 'custom-provider/model-1',
        headless: true,
      },
      concurrency: 1,
    }, {
      verbose: false,
    })

    expect(result.cancelled).toBe(true)
    expect(result.features[0]!.scenarios[0]!.failureKind).toBe('cancellation')
  })
})

describe('cancelRun', () => {
  test('closes active stagehands and stops the active server', async () => {
    state.stopServerCalls = 0
    const closed: string[] = []
    const fakeStagehand = {
      close: async () => {
        closed.push('stagehand')
      },
      browser: {
        close: async () => {
          closed.push('browser')
        },
      },
    }

    cancellation.addActiveStagehand(fakeStagehand as any)
    cancellation.setActiveServer({
      process: {} as any,
      stop: () => {
        closed.push('server')
      },
    })

    cancelRun()
    await Bun.sleep(10)

    expect(closed).toContain('stagehand')
    expect(closed).toContain('browser')
    expect(state.stopServerCalls).toBeGreaterThan(0)
  })
})
