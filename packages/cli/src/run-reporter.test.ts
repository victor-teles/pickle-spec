import { expect, test } from 'bun:test'
import type { ScenarioRun } from '@pickle-spec/runner'
import { createRunReporter, terminalReporterCapabilities } from './run-reporter'

type PassedRunInput = {
  specificationUri: string
  specificationName: string
  scenarioId: string
  scenarioName: string
  profileId: string
  durationMs: number
}

function passedRun(input: PassedRunInput): ScenarioRun {
  return {
    events: [],
    result: {
      schemaVersion: 1,
      specification: {
        uri: input.specificationUri,
        name: input.specificationName,
      },
      scenario: { id: input.scenarioId, name: input.scenarioName },
      executionTargetProfile: { id: input.profileId },
      state: 'passed',
      steps: [],
      durationMs: input.durationMs,
    },
  }
}

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
  })
  expect(terminalReporterCapabilities(true, 100, '')).toEqual({
    color: false,
    columns: 100,
  })
  expect(terminalReporterCapabilities(false, undefined, undefined)).toEqual({
    color: false,
    columns: undefined,
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
