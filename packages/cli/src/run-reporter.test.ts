import { expect, test } from 'bun:test'
import { createRunReporter, terminalReporterCapabilities } from './run-reporter'
import { passedRun } from './run-reporter.test-support'

test('renders completed Test results as Vitest-style lines', () => {
  const lines: string[] = []
  const reporter = createRunReporter('default', {
    write: (line) => lines.push(line),
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
    columns: 120,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  })

  reporter.start()
  reporter.finish(
    [
      passedRun({
        specificationUri: 'src/google.feature',
        specificationName: 'Search',
        scenarioId: 'scenario-visit',
        scenarioName: 'Visit main page',
        profileId: 'web',
        durationMs: 150,
      }),
      passedRun({
        specificationUri: 'src/google.feature',
        specificationName: 'Search',
        scenarioId: 'scenario-visit',
        scenarioName: 'Visit main page',
        profileId: 'android',
        durationMs: 1_240,
      }),
      passedRun({
        specificationUri: 'src/google.feature',
        specificationName: 'Search',
        scenarioId: 'scenario-find',
        scenarioName: 'Find pickles',
        profileId: 'web',
        durationMs: 820,
      }),
      passedRun({
        specificationUri: 'features/checkout.feature',
        specificationName: 'Checkout',
        scenarioId: 'scenario-purchase',
        scenarioName: 'Complete a purchase',
        profileId: 'web',
        durationMs: 5,
      }),
    ],
    1_460,
  )

  expect(lines.join('\n')).toBe(`
 RUN  pickle 1.0.2 /workspace/project

 ✓ [web] src/google.feature > Visit main page [150ms]
 ✓ [android] src/google.feature > Visit main page [1.24s]
 ✓ [web] src/google.feature > Find pickles [820ms]
 ✓ [web] features/checkout.feature > Complete a purchase [5ms]

 Specifications  2
 Scenarios       3
 Test results    4 passed (4)
 Start at        14:32:07
 Duration        1.46s`)
})

test('streams Test results in completion order without repeating them at finish', () => {
  const runs = [
    passedRun({
      specificationUri: 'features/a.feature',
      specificationName: 'First',
      scenarioId: 'scenario-a-one',
      scenarioName: 'First Scenario',
      profileId: 'web',
      durationMs: 10,
    }),
    passedRun({
      specificationUri: 'features/a.feature',
      specificationName: 'First',
      scenarioId: 'scenario-a-one',
      scenarioName: 'First Scenario',
      profileId: 'android',
      durationMs: 20,
    }),
    passedRun({
      specificationUri: 'features/a.feature',
      specificationName: 'First',
      scenarioId: 'scenario-a-two',
      scenarioName: 'Second Scenario',
      profileId: 'web',
      durationMs: 30,
    }),
    passedRun({
      specificationUri: 'features/a.feature',
      specificationName: 'First',
      scenarioId: 'scenario-a-two',
      scenarioName: 'Second Scenario',
      profileId: 'android',
      durationMs: 40,
    }),
    passedRun({
      specificationUri: 'features/b.feature',
      specificationName: 'Second',
      scenarioId: 'scenario-b',
      scenarioName: 'Ready early',
      profileId: 'web',
      durationMs: 50,
    }),
    passedRun({
      specificationUri: 'features/b.feature',
      specificationName: 'Second',
      scenarioId: 'scenario-b',
      scenarioName: 'Ready early',
      profileId: 'android',
      durationMs: 60,
    }),
  ]
  const schedule = runs.map(({ result }) => ({
    specification: result.specification,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
  }))
  const options = {
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
    columns: 120,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  }
  const progressiveLines: string[] = []
  const progressiveReporter = createRunReporter('default', {
    ...options,
    write: (line) => progressiveLines.push(line),
  })

  progressiveReporter.start()
  progressiveReporter.prepare?.(schedule)
  for (const index of [4, 5, 3, 1, 0]) {
    progressiveReporter.complete?.(runs[index]!.result)
  }
  expect(progressiveLines.join('\n')).toContain(
    '✓ [web] features/b.feature > Ready early [50ms]',
  )
  expect(progressiveLines.join('\n')).toContain(
    '✓ [web] features/a.feature > First Scenario [10ms]',
  )

  progressiveReporter.complete?.(runs[2]!.result)
  progressiveReporter.finish(runs, 100)

  const resultLines = progressiveLines.filter((line) => /[✓×!↓○]/u.test(line))
  expect(resultLines).toEqual([
    ' ✓ [web] features/b.feature > Ready early [50ms]',
    ' ✓ [android] features/b.feature > Ready early [60ms]',
    ' ✓ [android] features/a.feature > Second Scenario [40ms]',
    ' ✓ [android] features/a.feature > First Scenario [20ms]',
    ' ✓ [web] features/a.feature > First Scenario [10ms]',
    ' ✓ [web] features/a.feature > Second Scenario [30ms]',
  ])
  expect(progressiveLines).toContain(' Test results    6 passed (6)')
})

test('keeps schedule and completion callbacks out of NDJSON output', () => {
  const run = passedRun({
    specificationUri: 'features/a.feature',
    specificationName: 'First',
    scenarioId: 'scenario-a',
    scenarioName: 'Scenario A',
    profileId: 'web',
    durationMs: 10,
  })
  const lines: string[] = []
  const reporter = createRunReporter('ndjson', {
    write: (line) => lines.push(line),
  })

  reporter.start()
  reporter.prepare?.([
    {
      specification: run.result.specification,
      scenario: run.result.scenario,
      executionTargetProfile: run.result.executionTargetProfile,
    },
  ])
  reporter.complete?.(run.result)
  expect(lines).toEqual([])

  reporter.finish([run], 10)
  expect(lines).toHaveLength(1)
  expect(JSON.parse(lines[0]!)).toEqual({
    kind: 'test-result',
    result: run.result,
  })
})

test('streams human output as each Test result completes', () => {
  const run = passedRun({
    specificationUri: 'features/a.feature',
    specificationName: 'First',
    scenarioId: 'scenario-a',
    scenarioName: 'Scenario A',
    profileId: 'web',
    durationMs: 10,
  })
  const lines: string[] = []
  const reporter = createRunReporter('default', {
    write: (line) => lines.push(line),
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: true,
    columns: 120,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  })

  reporter.start()
  reporter.prepare?.([
    {
      specification: run.result.specification,
      scenario: run.result.scenario,
      executionTargetProfile: run.result.executionTargetProfile,
    },
  ])
  reporter.complete?.(run.result)
  expect(lines.join('\n')).toContain('features/a.feature > Scenario A [10ms]')

  reporter.finish([run], 10)
  expect(
    lines.filter((line) => line.includes('features/a.feature')),
  ).toHaveLength(1)
})

test('uses a visible failure symbol with color only as supplemental information', () => {
  const run = passedRun({
    specificationUri: 'src/google.feature',
    specificationName: 'Search',
    scenarioId: 'scenario-visit',
    scenarioName: 'Visit main page',
    profileId: 'web',
    durationMs: 150,
  })
  run.result.state = 'failed'
  const colorLines: string[] = []
  const plainLines: string[] = []
  const sharedOptions = {
    projectRoot: '/workspace/project',
    version: '1.0.2',
    columns: 120,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  }
  const colorReporter = createRunReporter('default', {
    ...sharedOptions,
    color: true,
    write: (line) => colorLines.push(line),
  })
  const plainReporter = createRunReporter('default', {
    ...sharedOptions,
    color: false,
    write: (line) => plainLines.push(line),
  })

  colorReporter.start()
  colorReporter.finish([run], 150)
  plainReporter.start()
  plainReporter.finish([run], 150)

  expect(colorLines.join('\n')).toContain('\u001b[31m×\u001b[39m')
  expect(plainLines.join('\n')).not.toContain('\u001b[')
  expect(plainLines.join('\n')).toContain(
    '× src/google.feature > Visit main page [150ms] (failed)',
  )
})

test('wraps long paths and Scenario names without truncating them', () => {
  const specificationUri =
    'features/a-very-long-directory/google-search.feature'
  const scenarioName = 'A Scenario name that keeps all context'
  const lines: string[] = []
  const reporter = createRunReporter('default', {
    write: (line) => lines.push(line),
    projectRoot: '/workspace/a-very-long-project-name',
    version: '1.0.2',
    color: false,
    columns: 32,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  })

  reporter.start()
  reporter.finish(
    [
      passedRun({
        specificationUri,
        specificationName: 'Search across a long product catalog',
        scenarioId: 'scenario-search',
        scenarioName,
        profileId: 'web',
        durationMs: 150,
      }),
    ],
    150,
  )

  expect(lines.every((line) => line.length <= 32)).toBe(true)
  const resultStart = lines.findIndex((line) => line.includes('✓'))
  const summaryStart = lines.findIndex((line) =>
    line.includes('Specifications'),
  )
  const renderedResult = lines
    .slice(resultStart, summaryStart)
    .join('')
    .replace(/\s/gu, '')
  expect(renderedResult).toContain(
    `${specificationUri}>${scenarioName}[150ms]`.replace(/\s/gu, ''),
  )
})

test('wraps non-BMP Unicode names without corrupting their characters', () => {
  const scenarioName = `${'🫙'.repeat(12)}${'👨‍👩‍👧‍👦'.repeat(2)}`
  const lines: string[] = []
  const reporter = createRunReporter('default', {
    write: (line) => lines.push(line),
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
    columns: 14,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  })

  reporter.start()
  reporter.finish(
    [
      passedRun({
        specificationUri: 'a.feature',
        specificationName: 'Search',
        scenarioId: 'scenario-unicode',
        scenarioName,
        profileId: 'web',
        durationMs: 150,
      }),
    ],
    150,
  )

  expect(lines.join('\n')).not.toContain('�')
  const unicodeLines = lines.filter((line) => /[🫙👨👩👧👦‍]/u.test(line))
  expect(unicodeLines.every((line) => Bun.stringWidth(line) <= 14)).toBe(true)
  expect(
    unicodeLines.every(
      (line) => !line.trim().startsWith('‍') && !line.trim().endsWith('‍'),
    ),
  ).toBe(true)
  expect(
    lines
      .filter((line) => line.includes('🫙'))
      .join('')
      .match(/🫙/gu),
  ).toHaveLength(12)
})

test('counts Test result states as mutually exclusive summary outcomes', () => {
  const states = [
    'passed',
    'passed-with-adaptation',
    'failed',
    'infrastructure-error',
    'skipped',
    'cancelled',
  ] as const
  const lines: string[] = []
  const reporter = createRunReporter('default', {
    write: (line) => lines.push(line),
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
    columns: 120,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  })
  const runs = states.map((state, index) => {
    const run = passedRun({
      specificationUri: 'src/google.feature',
      specificationName: 'Search',
      scenarioId: `scenario-${index}`,
      scenarioName: `Scenario ${index}`,
      profileId: 'web',
      durationMs: 150,
    })
    return { ...run, result: { ...run.result, state } }
  })

  reporter.start()
  reporter.finish(runs, 150)

  expect(lines).toContain(
    ' Test results    1 failed | 1 infrastructure error | 2 passed | 1 skipped | 1 cancelled (6)',
  )
  expect(lines.join('\n')).toContain(
    '× src/google.feature > Scenario 2 [150ms] (failed)',
  )
  expect(lines.join('\n')).toContain(
    '! src/google.feature > Scenario 3 [150ms] (infrastructure error)',
  )
  expect(lines.join('\n')).toContain(
    '↓ src/google.feature > Scenario 4 [150ms] (skipped)',
  )
  expect(lines.join('\n')).toContain(
    '○ src/google.feature > Scenario 5 [150ms] (cancelled)',
  )
})

test('renders execution mode, Cache outcome, and inference count independently from state', () => {
  const lines: string[] = []
  const reporter = createRunReporter('default', {
    write: (line) => lines.push(line),
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
    columns: 180,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  })
  const replay = passedRun({
    specificationUri: 'features/checkout.feature',
    specificationName: 'Checkout',
    scenarioId: 'scenario-replay',
    scenarioName: 'Replay checkout',
    profileId: 'web',
    durationMs: 12,
  })
  replay.result.executionMode = 'replay'
  replay.result.cacheOutcome = 'hit'
  replay.result.inferenceCount = 0
  const fallback = passedRun({
    specificationUri: 'features/checkout.feature',
    specificationName: 'Checkout',
    scenarioId: 'scenario-fallback',
    scenarioName: 'Recover checkout',
    profileId: 'web',
    durationMs: 25,
  })
  fallback.result.executionMode = 'adaptive'
  fallback.result.cacheOutcome = 'fallback'
  fallback.result.inferenceCount = 2
  const uncacheable = passedRun({
    specificationUri: 'features/checkout.feature',
    specificationName: 'Checkout',
    scenarioId: 'scenario-uncacheable',
    scenarioName: 'Inspect checkout',
    profileId: 'web',
    durationMs: 30,
  })
  uncacheable.result.executionMode = 'adaptive'
  uncacheable.result.cacheOutcome = 'uncacheable'
  uncacheable.result.cacheUncacheableReason = 'non-deterministic-assertion'
  uncacheable.result.inferenceCount = 3

  reporter.start()
  reporter.finish([replay, fallback, uncacheable], 67)

  const output = lines.join('\n')
  expect(output).toContain(
    'Replay checkout [12ms] (mode Replay; cache hit; 0 inferences)',
  )
  expect(output).toContain(
    'Recover checkout [25ms] (mode Adaptive; cache fallback; 2 inferences)',
  )
  expect(output).toContain(
    'Inspect checkout [30ms] (mode Adaptive; cache uncacheable: non-deterministic-assertion; 3 inferences)',
  )
  expect(output).toContain(' Test results    3 passed (3)')
})

test('enables color only for a TTY when NO_COLOR is absent', () => {
  expect(terminalReporterCapabilities(true, 100, undefined)).toEqual({
    color: true,
    columns: 100,
    interactive: true,
  })
  expect(terminalReporterCapabilities(true, 100, '')).toEqual({
    color: false,
    columns: 100,
    interactive: true,
  })
  expect(terminalReporterCapabilities(false, undefined, undefined)).toEqual({
    color: false,
    columns: undefined,
    interactive: false,
  })
  expect(terminalReporterCapabilities(true, 100, undefined, 'dumb')).toEqual({
    color: false,
    columns: 100,
    interactive: false,
  })
})

test('preserves result-level failure messages when no executed step owns them', () => {
  const lines: string[] = []
  const reporter = createRunReporter('default', {
    write: (line) => lines.push(line),
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
    columns: 48,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  })
  const run = passedRun({
    specificationUri: 'src/google.feature',
    specificationName: 'Search',
    scenarioId: 'scenario-search',
    scenarioName: 'Find pickles',
    profileId: 'web',
    durationMs: 150,
  })
  run.result.state = 'failed'
  run.result.message =
    'Expected results, but the page remained empty\nScreenshot captured'

  reporter.start()
  reporter.finish([run], 150)

  expect(lines.join('\n')).toContain(
    '   Message\n' +
      '     Expected results, but the page remained\n' +
      '     empty\n' +
      '     Screenshot captured',
  )
})

test('renders functional failure diagnostics from executed Gherkin steps without resolved actions', () => {
  const lines: string[] = []
  const reporter = createRunReporter('default', {
    write: (line) => lines.push(line),
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
    columns: 120,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  })
  const run = passedRun({
    specificationUri: 'features/checkout.feature',
    specificationName: 'Checkout',
    scenarioId: 'scenario-purchase',
    scenarioName: 'Complete a purchase',
    profileId: 'web',
    durationMs: 150,
  })
  run.result.state = 'failed'
  run.result.message = 'Expected confirmation\nbut the page remained empty'
  run.result.steps = [
    {
      step: {
        keyword: 'Given',
        text: 'a product is in the basket',
        type: 'context',
      },
      state: 'passed',
      resolvedActions: [{ description: 'Open the basket internals' }],
    },
    {
      step: {
        keyword: 'Then',
        text: 'the purchase succeeds',
        type: 'outcome',
      },
      state: 'failed',
      resolvedActions: [{ description: 'Inspect the confirmation internals' }],
      message: 'Expected confirmation\nbut the page remained empty',
    },
  ]

  reporter.start()
  reporter.finish([run], 150)

  const output = lines.join('\n')
  expect(output).toContain(` Failures

 × Failure
   Specification  Checkout (features/checkout.feature)
   Scenario       Complete a purchase
   Steps
     ✓ Given a product is in the basket
     × Then the purchase succeeds
       Expected confirmation
       but the page remained empty`)
  expect(output).not.toContain('Open the basket internals')
  expect(output).not.toContain('Inspect the confirmation internals')
  expect(output.indexOf('features/checkout.feature')).toBeLessThan(
    output.indexOf(' Failures'),
  )
  expect(output.indexOf(' Failures')).toBeLessThan(
    output.indexOf(' Test results'),
  )
})

test('separates infrastructure diagnostics and renders profiles, messages, and artifact paths', () => {
  const lines: string[] = []
  const reporter = createRunReporter('default', {
    write: (line) => lines.push(line),
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
    columns: 120,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  })
  const failedRun = passedRun({
    specificationUri: 'features/checkout.feature',
    specificationName: 'Checkout',
    scenarioId: 'scenario-purchase',
    scenarioName: 'Complete a purchase',
    profileId: 'web',
    durationMs: 150,
  })
  failedRun.result.state = 'failed'
  failedRun.result.steps = [
    {
      step: {
        keyword: 'Then',
        text: 'the purchase succeeds',
        type: 'outcome',
      },
      state: 'failed',
      resolvedActions: [],
      message: 'Confirmation was not visible',
      artifacts: [
        {
          kind: 'screenshot',
          path: '/workspace/project/.pickle/runs/run-1/artifacts/failure.png',
        },
      ],
    },
  ]
  const infrastructureRun = passedRun({
    specificationUri: 'features/search.feature',
    specificationName: 'Search',
    scenarioId: 'scenario-search',
    scenarioName: 'Find pickles',
    profileId: 'android',
    durationMs: 240,
  })
  infrastructureRun.result.state = 'infrastructure-error'
  infrastructureRun.result.message =
    'Emulator disconnected\nwhile the outcome step was running'
  infrastructureRun.result.steps = [
    {
      step: {
        keyword: 'Given',
        text: 'the catalog is open',
        type: 'context',
      },
      state: 'passed',
      resolvedActions: [],
    },
    {
      step: {
        keyword: 'Then',
        text: 'pickle results are visible',
        type: 'outcome',
      },
      state: 'infrastructure-error',
      resolvedActions: [],
      message: 'Emulator disconnected\nwhile the outcome step was running',
      artifacts: [
        {
          kind: 'device-log',
          path: '/workspace/project/.pickle/runs/run-1/artifacts/device.log',
        },
        { kind: 'trace', path: '/var/tmp/pickle-external/trace.zip' },
      ],
    },
  ]

  reporter.start()
  reporter.finish([infrastructureRun, failedRun], 390)

  const output = lines.join('\n')
  expect(output).toContain(` Failures

 × Failure
   Specification  Checkout (features/checkout.feature)
   Scenario       Complete a purchase
   Profile        web`)
  expect(output).toContain(
    '       Artifacts\n' +
      '         screenshot: .pickle/runs/run-1/artifacts/failure.png',
  )
  expect(output).toContain(` Infrastructure errors

 ! Infrastructure error
   Specification  Search (features/search.feature)
   Scenario       Find pickles
   Profile        android
   Steps
     ✓ Given the catalog is open
     ! Then pickle results are visible
       Emulator disconnected
       while the outcome step was running
       Artifacts
         device-log: .pickle/runs/run-1/artifacts/device.log
         trace: /var/tmp/pickle-external/trace.zip`)
  expect(output).toContain(
    ' Test results    1 failed | 1 infrastructure error (2)',
  )
  expect(output.indexOf('Specification  Checkout')).toBeLessThan(
    output.indexOf('Specification  Search'),
  )
})
