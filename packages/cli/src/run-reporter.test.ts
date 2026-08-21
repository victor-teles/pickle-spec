import { expect, test } from 'bun:test'
import { createRunReporter, terminalReporterCapabilities } from './run-reporter'
import { passedRun } from './run-reporter.test-support'

test('renders a successful test run as a stable Specification-first tree', () => {
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

 features/checkout.feature
   Checkout
     ✓ [web] Complete a purchase [5ms]

 src/google.feature
   Search
     ✓ [web] Visit main page [150ms]
     ✓ [android] Visit main page [1.24s]
     ✓ [web] Find pickles [820ms]

 Specifications  2
 Scenarios       3
 Test results    4 passed (4)
 Start at        14:32:07
 Duration        1.46s`)
})

test('streams contiguous ready Specification blocks in final report order', () => {
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
    progressive: true,
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
  expect(progressiveLines.join('\n')).not.toContain('features/a.feature')
  expect(progressiveLines.join('\n')).not.toContain('features/b.feature')

  progressiveReporter.complete?.(runs[2]!.result)
  progressiveReporter.complete?.(runs[4]!.result)
  expect(progressiveLines.join('\n')).toContain('features/b.feature')
  progressiveReporter.finish(runs, 100)

  const finishOnlyLines: string[] = []
  const finishOnlyReporter = createRunReporter('default', {
    ...options,
    write: (line) => finishOnlyLines.push(line),
  })
  finishOnlyReporter.start()
  finishOnlyReporter.finish(runs, 100)

  expect(progressiveLines).toEqual(finishOnlyLines)
  expect(progressiveLines.join('\n')).toContain(
    '✓ [web] First Scenario [10ms]\n' +
      '     ✓ [android] First Scenario [20ms]\n' +
      '     ✓ [web] Second Scenario [30ms]\n' +
      '     ✓ [android] Second Scenario [40ms]',
  )
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

test('keeps interactive human output buffered until the run finishes', () => {
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
    progressive: false,
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
  expect(lines.join('\n')).not.toContain('features/a.feature')

  reporter.finish([run], 10)
  expect(lines.join('\n')).toContain('features/a.feature')
})

test('uses color only as supplemental terminal state information', () => {
  const run = passedRun({
    specificationUri: 'src/google.feature',
    specificationName: 'Search',
    scenarioId: 'scenario-visit',
    scenarioName: 'Visit main page',
    profileId: 'web',
    durationMs: 150,
  })
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

  expect(colorLines.join('\n')).toContain('\u001b[32m✓\u001b[39m')
  expect(plainLines.join('\n')).not.toContain('\u001b[')
  expect(plainLines.join('\n')).toContain('✓ Visit main page [150ms]')
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
  const uriStart = lines.findIndex((line) => line.includes('features/'))
  expect(`${lines[uriStart]?.trim()}${lines[uriStart + 1]?.trim()}`).toBe(
    specificationUri,
  )
  const scenarioStart = lines.findIndex((line) => line.includes('✓'))
  const renderedScenario = `${lines[scenarioStart]?.trim().slice(2)} ${lines[
    scenarioStart + 1
  ]?.trim()}`
  expect(renderedScenario).toBe(`${scenarioName} [150ms]`)
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
    ' Test results    1 failed | 1 infrastructure error | 1 adapted | 1 passed | 1 skipped | 1 cancelled (6)',
  )
  expect(lines.join('\n')).toContain('× Scenario 2 [150ms] (failed)')
  expect(lines.join('\n')).toContain(
    '! Scenario 3 [150ms] (infrastructure error)',
  )
  expect(lines.join('\n')).toContain('↓ Scenario 4 [150ms] (skipped)')
  expect(lines.join('\n')).toContain('○ Scenario 5 [150ms] (cancelled)')
})

test('enables color only for a TTY when NO_COLOR is absent', () => {
  expect(terminalReporterCapabilities(true, 100, undefined)).toEqual({
    color: true,
    columns: 100,
    interactive: true,
    progressive: false,
  })
  expect(terminalReporterCapabilities(true, 100, '')).toEqual({
    color: false,
    columns: 100,
    interactive: true,
    progressive: false,
  })
  expect(terminalReporterCapabilities(false, undefined, undefined)).toEqual({
    color: false,
    columns: undefined,
    interactive: false,
    progressive: true,
  })
  expect(terminalReporterCapabilities(true, 100, undefined, 'dumb')).toEqual({
    color: false,
    columns: 100,
    interactive: false,
    progressive: true,
  })
})

test('preserves Test result messages in the human report', () => {
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
    '       Expected results, but the page remained\n' +
      '       empty\n' +
      '       Screenshot captured',
  )
})
