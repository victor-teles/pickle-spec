import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { runCommandAction, resolveReportOpenModeFromArgv } from './cli-app'
import type { ParsedFeature } from './parser'
import type { PickleSpecConfig, RunResult } from './types'

function makeStep(id: string, text: string) {
  return {
    id,
    text,
    astNodeIds: [`${id}-ast`],
  }
}

function makeFeature(name = 'Feature One'): ParsedFeature {
  const pickle = {
    id: 'pickle-1',
    name: 'Scenario One',
    language: 'en',
    uri: 'file:///tmp/feature-one.feature',
    steps: [makeStep('step-1', 'I click the button')],
    tags: [{ name: '@smoke', id: 'tag-1', astNodeId: 'tag-1-ast' }],
    astNodeIds: ['pickle-1-ast'],
  }

  return {
    filePath: '/tmp/feature-one.feature',
    featureName: name,
    document: {} as any,
    pickles: [pickle],
  }
}

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    features: [],
    totalDurationMs: 10,
    passed: 1,
    failed: 0,
    skipped: 0,
    artifactsDir: '/tmp/artifacts',
    ...overrides,
  }
}

describe('resolveReportOpenModeFromArgv', () => {
  test('returns the last report-open flag in argv order', () => {
    expect(resolveReportOpenModeFromArgv(['pickle', 'run'])).toBeUndefined()
    expect(resolveReportOpenModeFromArgv(['pickle', 'run', '--open-report'])).toBe('always')
    expect(resolveReportOpenModeFromArgv(['pickle', 'run', '--no-open-report'])).toBe('never')
    expect(resolveReportOpenModeFromArgv(['pickle', 'run', '--open-report', '--no-open-report'])).toBe('never')
  })
})

describe('runCommandAction', () => {
  let openReportMock: ReturnType<typeof mock>
  let reportSummaryMock: ReturnType<typeof mock>
  let reportErrorMock: ReturnType<typeof mock>
  let parseFeatureFilesMock: ReturnType<typeof mock>
  let runFeaturesMock: ReturnType<typeof mock>
  let loadConfigMock: ReturnType<typeof mock>
  let normalizeConfigMock: ReturnType<typeof mock>
  let generateHtmlReportMock: ReturnType<typeof mock>
  let writeStructuredOutputsMock: ReturnType<typeof mock>

  beforeEach(() => {
    openReportMock = mock(() => true)
    reportSummaryMock = mock(() => {})
    reportErrorMock = mock(() => {})
    parseFeatureFilesMock = mock(async () => [makeFeature()])
    runFeaturesMock = mock(async () => makeResult())
    loadConfigMock = mock(async () => ({
      server: {
        url: 'http://localhost:3000',
      },
      browser: {
        env: 'LOCAL',
        modelName: 'custom-provider/model-1',
        headless: true,
      },
      report: {
        open: 'auto',
      },
      concurrency: 3,
      verbose: false,
    } satisfies PickleSpecConfig))
    normalizeConfigMock = mock((config: PickleSpecConfig) => ({
      report: {
        open: 'auto',
      },
      browser: {
        env: 'LOCAL',
        modelName: 'custom-provider/model-1',
        headless: true,
        ...config.browser,
      },
      server: {
        url: 'http://localhost:3000',
        ...config.server,
      },
      concurrency: 3,
      verbose: false,
      ...config,
    }))
    generateHtmlReportMock = mock(async (result: RunResult) => {
      result.reportPath = '/tmp/artifacts/report.html'
      return '/tmp/artifacts/report.html'
    })
    writeStructuredOutputsMock = mock(async () => ['/tmp/results/run.json'])
  })

  function makeDeps(overrides: Record<string, unknown> = {}) {
    return {
      cancelRun: mock(() => {}),
      generateHtmlReport: generateHtmlReportMock,
      loadConfig: loadConfigMock,
      normalizeConfig: normalizeConfigMock,
      openReport: openReportMock,
      parseFeatureFiles: parseFeatureFilesMock,
      reportCancelled: mock(() => {}),
      reportError: reportErrorMock,
      reportSummary: reportSummaryMock,
      runFeatures: runFeaturesMock,
      shouldOpenReport: ({ mode, env, isTTY }: { mode?: string; env?: NodeJS.ProcessEnv; isTTY?: boolean }) => {
        if (mode === 'never') return false
        if (mode === 'always') return true
        return !env?.CI && Boolean(isTTY)
      },
      writeStructuredOutputs: writeStructuredOutputsMock,
      runtime: {
        argv: ['pickle', 'run'],
        env: {},
        isTTY: true,
        platform: 'darwin' as const,
      },
      ...overrides,
    }
  }

  test('applies CLI overrides before normalization', async () => {
    const deps = makeDeps()

    await runCommandAction(undefined, {
      headed: true,
      concurrency: 5,
      screenshot: 'on-failure',
      language: 'pt',
      reportOpenMode: 'always',
    }, deps as any)

    expect(normalizeConfigMock).toHaveBeenCalledTimes(1)
    const normalizedInput = normalizeConfigMock.mock.calls[0]![0] as PickleSpecConfig
    expect(normalizedInput.browser!.headless).toBe(false)
    expect(normalizedInput.concurrency).toBe(5)
    expect(normalizedInput.screenshots!.mode).toBe('on-failure')
    expect(normalizedInput.report!.open).toBe('always')
    expect(normalizedInput.filter).toBeUndefined()
    expect(parseFeatureFilesMock).toHaveBeenCalledWith('features/**/*.feature', 'pt')
  })

  test('applies Phase 2 CLI overrides before normalization', async () => {
    const deps = makeDeps()

    await runCommandAction(undefined, {
      scenario: 'checkout',
      tag: '@smoke and not @ignore',
      shard: '2/3',
      json: '/tmp/results/out.json',
      junit: '/tmp/results/out.xml',
      retries: 2,
      scenarioTimeout: 4000,
      stepTimeout: 1000,
      reuseServer: true,
    }, deps as any)

    const normalizedInput = normalizeConfigMock.mock.calls[0]![0] as PickleSpecConfig
    expect(normalizedInput.filter).toEqual({
      scenarioName: 'checkout',
      tagExpression: '@smoke and not @ignore',
    })
    expect(normalizedInput.shard).toEqual({ index: 2, total: 3 })
    expect(normalizedInput.output).toEqual({
      json: { path: '/tmp/results/out.json' },
      junit: { path: '/tmp/results/out.xml' },
    })
    expect(normalizedInput.execution).toEqual({
      retries: 2,
      retryOn: 'infrastructure',
      scenarioTimeoutMs: 4000,
      stepTimeoutMs: 1000,
    })
    expect(normalizedInput.server?.reuseExisting).toBe(true)
  })

  test('opens report by default for local interactive runs', async () => {
    const exitCode = await runCommandAction(undefined, {}, makeDeps() as any)

    expect(exitCode).toBe(0)
    expect(reportSummaryMock).toHaveBeenCalledTimes(1)
    const result = reportSummaryMock.mock.calls[0]![0] as RunResult
    expect(result.reportPath).toBe('/tmp/artifacts/report.html')
    expect(writeStructuredOutputsMock).toHaveBeenCalledTimes(1)
    expect(openReportMock).toHaveBeenCalledWith('/tmp/artifacts/report.html', 'darwin')
  })

  test('does not open report automatically in CI', async () => {
    const deps = makeDeps({
      runtime: {
        argv: ['pickle', 'run'],
        env: { CI: 'true' },
        isTTY: true,
        platform: 'darwin' as const,
      },
    })

    await runCommandAction(undefined, {}, deps as any)

    expect(openReportMock).not.toHaveBeenCalled()
  })

  test('respects explicit no-open-report override', async () => {
    await runCommandAction(undefined, {
      reportOpenMode: 'never',
    }, makeDeps() as any)

    expect(openReportMock).not.toHaveBeenCalled()
  })

  test('returns validation failures as exit code 1', async () => {
    const deps = makeDeps({
      normalizeConfig: mock(() => {
        throw new Error('Invalid config: concurrency must be an integer greater than or equal to 1')
      }),
    })

    const exitCode = await runCommandAction(undefined, {}, deps as any)

    expect(exitCode).toBe(1)
    expect(reportErrorMock).toHaveBeenCalledWith(expect.stringContaining('concurrency'))
  })

  test('returns exit code 1 when no scenarios match a tag', async () => {
    const exitCode = await runCommandAction(undefined, {
      tag: '@missing',
    }, makeDeps() as any)

    expect(exitCode).toBe(1)
    expect(reportErrorMock).toHaveBeenCalledWith('No scenarios found matching the current filters')
  })

  test('adds selection metadata to the run result', async () => {
    const deps = makeDeps()

    await runCommandAction(undefined, {
      scenario: 'scenario',
      tag: '@smoke',
      shard: '1/2',
    }, deps as any)

    const result = generateHtmlReportMock.mock.calls[0]![0] as RunResult
    expect(result.selection).toEqual({
      scenarioName: 'scenario',
      tagExpression: '@smoke',
      shard: { index: 1, total: 2 },
    })
  })

  test('returns exit code 1 when run results contain failures', async () => {
    const exitCode = await runCommandAction(undefined, {}, makeDeps({
      runFeatures: mock(async () => makeResult({
        passed: 0,
        failed: 1,
      })),
    }) as any)

    expect(exitCode).toBe(1)
  })
})
