import { expect, test } from 'bun:test'
import type { ScenarioRun } from '@pickle-spec/runner'
import { createRunReporter, terminalReporterCapabilities } from './run-reporter'

type TerminalOperation = {
  type: 'commit' | 'finish' | 'update'
  lines: string[]
}

function recordingTerminal(
  columns: () => number | undefined,
  rows: () => number | undefined = () => 24,
) {
  const operations: TerminalOperation[] = []
  return {
    operations,
    surface: {
      columns,
      rows,
      commit(lines: readonly string[]) {
        operations.push({ type: 'commit', lines: [...lines] })
      },
      finish(lines: readonly string[]) {
        operations.push({ type: 'finish', lines: [...lines] })
      },
      update(lines: readonly string[]) {
        operations.push({ type: 'update', lines: [...lines] })
      },
    },
  }
}

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

test('updates active Specifications and commits each completed block once', () => {
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
      scenarioName: 'Other active Scenario',
      profileId: 'web',
      durationMs: 50,
    }),
  ]
  const schedule = runs.map(({ result }) => ({
    specification: result.specification,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
  }))
  const terminal = recordingTerminal(() => 120)
  const reporter = createRunReporter('default', {
    terminal: terminal.surface,
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  })

  reporter.start()
  reporter.prepare?.(schedule)
  reporter.event({
    schemaVersion: 1,
    sequence: 1,
    type: 'scenario-started',
    scenario: runs[0]!.result.scenario,
    executionTargetProfile: runs[0]!.result.executionTargetProfile,
  })

  const initialFrame = terminal.operations.at(-1)
  expect(initialFrame?.type).toBe('update')
  expect(initialFrame?.lines.join('\n')).toContain('features/a.feature')
  expect(initialFrame?.lines.join('\n')).toContain('0/4 Test results')
  expect(initialFrame?.lines.join('\n')).not.toContain('Second Scenario')

  reporter.complete?.(runs[0]!.result)
  reporter.event({
    schemaVersion: 1,
    sequence: 2,
    type: 'scenario-started',
    scenario: runs[4]!.result.scenario,
    executionTargetProfile: runs[4]!.result.executionTargetProfile,
  })

  const concurrentFrame = terminal.operations.at(-1)
  expect(concurrentFrame?.type).toBe('update')
  expect(concurrentFrame?.lines.join('\n')).toContain('1/4 Test results')
  expect(concurrentFrame?.lines.join('\n')).toContain('First Scenario [10ms]')
  expect(concurrentFrame?.lines.join('\n')).toContain('features/b.feature')
  expect(concurrentFrame?.lines.join('\n')).toContain('0/1 Test result')

  for (const run of runs.slice(1, 4)) reporter.complete?.(run.result)

  const commits = terminal.operations.filter(
    (operation) => operation.type === 'commit',
  )
  expect(commits).toHaveLength(2)
  expect(commits[0]?.lines.join('\n')).toContain('RUN  pickle 1.0.2')
  expect(commits[1]?.lines.join('\n')).toContain('features/a.feature')
  expect(commits[1]?.lines.join('\n')).toContain(
    '✓ [web] First Scenario [10ms]\n' +
      '     ✓ [android] First Scenario [20ms]\n' +
      '     ✓ [web] Second Scenario [30ms]\n' +
      '     ✓ [android] Second Scenario [40ms]',
  )
  expect(terminal.operations.at(-1)?.lines.join('\n')).toContain(
    'features/b.feature',
  )

  reporter.complete?.(runs[4]!.result)
  reporter.finish(runs, 50)

  const finishes = terminal.operations.filter(
    (operation) => operation.type === 'finish',
  )
  expect(finishes).toHaveLength(1)
  expect(finishes[0]?.lines.join('\n')).toContain('Specifications  2')
  expect(finishes[0]?.lines.join('\n')).toContain(
    'Test results    5 passed (5)',
  )
  expect(finishes[0]?.lines.join('\n')).not.toMatch(/[◐◓◑◒]/u)
  const permanentResults = terminal.operations
    .filter((operation) => operation.type === 'commit')
    .flatMap((operation) => operation.lines)
    .filter((line) => /[✓×!↓○]/u.test(line))
  expect(permanentResults).toHaveLength(5)
})

test('rewraps the dynamic region when an interactive terminal resizes', () => {
  const specificationUri =
    'features/a-very-long-directory/live-progress.feature'
  const run = passedRun({
    specificationUri,
    specificationName: 'Live progress',
    scenarioId: 'scenario-live',
    scenarioName: 'A completed Scenario with context',
    profileId: 'web',
    durationMs: 10,
  })
  let columns = 64
  const terminal = recordingTerminal(() => columns)
  const reporter = createRunReporter('default', {
    terminal: terminal.surface,
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
  })

  reporter.start()
  reporter.prepare?.([
    {
      specification: run.result.specification,
      scenario: run.result.scenario,
      executionTargetProfile: run.result.executionTargetProfile,
    },
    {
      specification: run.result.specification,
      scenario: { id: 'scenario-pending', name: 'Still pending' },
      executionTargetProfile: run.result.executionTargetProfile,
    },
  ])
  reporter.event({
    schemaVersion: 1,
    sequence: 1,
    type: 'scenario-started',
    scenario: run.result.scenario,
    executionTargetProfile: run.result.executionTargetProfile,
  })
  reporter.complete?.(run.result)

  columns = 28
  reporter.refresh?.()

  const resizedFrame = terminal.operations.at(-1)
  expect(resizedFrame?.type).toBe('update')
  expect(
    resizedFrame?.lines.every((line) => Bun.stringWidth(line) <= columns),
  ).toBe(true)
  expect(
    resizedFrame?.lines
      .filter((line) => line.includes('features/') || line.startsWith('   '))
      .map((line) => line.trim())
      .join(''),
  ).toContain(specificationUri)
  const scenarioStart = resizedFrame?.lines.findIndex((line) =>
    line.includes('✓'),
  )
  expect(
    resizedFrame?.lines
      .slice(scenarioStart)
      .map((line) => line.trim())
      .join(' '),
  ).toContain('A completed Scenario with context [10ms]')
})

test('clears live progress and preserves completed results when a run fails', () => {
  const completed = passedRun({
    specificationUri: 'features/live.feature',
    specificationName: 'Live',
    scenarioId: 'scenario-complete',
    scenarioName: 'Completed before failure',
    profileId: 'web',
    durationMs: 10,
  })
  const terminal = recordingTerminal(() => 80)
  const reporter = createRunReporter('default', {
    terminal: terminal.surface,
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  })

  reporter.start()
  reporter.prepare?.([
    {
      specification: completed.result.specification,
      scenario: completed.result.scenario,
      executionTargetProfile: completed.result.executionTargetProfile,
    },
    {
      specification: completed.result.specification,
      scenario: { id: 'scenario-pending', name: 'Interrupted' },
      executionTargetProfile: completed.result.executionTargetProfile,
    },
  ])
  reporter.event({
    schemaVersion: 1,
    sequence: 1,
    type: 'scenario-started',
    scenario: completed.result.scenario,
    executionTargetProfile: completed.result.executionTargetProfile,
  })
  reporter.complete?.(completed.result)

  reporter.fail?.(new Error('adapter disconnected'), 25)

  const permanentOutput = terminal.operations
    .filter((operation) => operation.type === 'commit')
    .flatMap((operation) => operation.lines)
    .join('\n')
  expect(permanentOutput).toContain('Completed before failure [10ms]')
  const finishes = terminal.operations.filter(
    (operation) => operation.type === 'finish',
  )
  expect(finishes).toHaveLength(1)
  expect(finishes[0]?.lines.join('\n')).toContain(
    'Run failed      adapter disconnected',
  )
  expect(finishes[0]?.lines.join('\n')).toContain(
    'Test results    1 passed (1)',
  )
  expect(finishes[0]?.lines.join('\n')).not.toMatch(/[◐◓◑◒]/u)
})

test('bounds result rendering while keeping every active Specification visible', () => {
  const runs = ['a', 'b', 'c'].flatMap((specificationId) =>
    Array.from({ length: 6 }, (_, index) =>
      passedRun({
        specificationUri: `features/${specificationId}.feature`,
        specificationName: `Specification ${specificationId}`,
        scenarioId: `scenario-${specificationId}-${index}`,
        scenarioName: `Scenario ${specificationId}-${index}`,
        profileId: 'web',
        durationMs: index,
      }),
    ),
  )
  const terminal = recordingTerminal(
    () => 80,
    () => 12,
  )
  const reporter = createRunReporter('default', {
    terminal: terminal.surface,
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
  })

  reporter.start()
  reporter.prepare?.(
    runs.map(({ result }) => ({
      specification: result.specification,
      scenario: result.scenario,
      executionTargetProfile: result.executionTargetProfile,
    })),
  )
  for (const specificationId of ['a', 'b', 'c']) {
    const specificationRuns = runs.filter(
      ({ result }) =>
        result.specification.uri === `features/${specificationId}.feature`,
    )
    reporter.event({
      schemaVersion: 1,
      sequence: 1,
      type: 'scenario-started',
      scenario: specificationRuns[0]!.result.scenario,
      executionTargetProfile:
        specificationRuns[0]!.result.executionTargetProfile,
    })
    for (const run of specificationRuns.slice(0, 5)) {
      reporter.complete?.(run.result)
    }
  }

  const frame = terminal.operations.at(-1)
  expect(frame?.type).toBe('update')
  expect(frame?.lines).toHaveLength(10)
  for (const specificationId of ['a', 'b', 'c']) {
    expect(frame?.lines.join('\n')).toContain(
      `5/6 Test results features/${specificationId}.feature`,
    )
  }
})

test('pages active Specification headers when their wrapped rows exceed the terminal', () => {
  const runs = ['a', 'b', 'c', 'd'].map((specificationId) =>
    passedRun({
      specificationUri: `features/long-${specificationId}.feature`,
      specificationName: `Specification ${specificationId}`,
      scenarioId: `scenario-${specificationId}`,
      scenarioName: `Scenario ${specificationId}`,
      profileId: 'web',
      durationMs: 1,
    }),
  )
  const terminal = recordingTerminal(
    () => 20,
    () => 7,
  )
  let scheduledRefresh: (() => void) | undefined
  let refreshCancelCount = 0
  const reporter = createRunReporter('default', {
    terminal: terminal.surface,
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
    scheduleRefresh(refresh) {
      scheduledRefresh = refresh
      return () => refreshCancelCount++
    },
  })

  reporter.start()
  reporter.prepare?.(
    runs.map(({ result }) => ({
      specification: result.specification,
      scenario: result.scenario,
      executionTargetProfile: result.executionTargetProfile,
    })),
  )
  runs.forEach((run, index) => {
    reporter.event({
      schemaVersion: 1,
      sequence: index + 1,
      type: 'scenario-started',
      scenario: run.result.scenario,
      executionTargetProfile: run.result.executionTargetProfile,
    })
  })
  const operationStart = terminal.operations.length
  expect(scheduledRefresh).toBeDefined()
  for (let index = 0; index < runs.length; index++) scheduledRefresh?.()

  const pagedOutput = terminal.operations
    .slice(operationStart)
    .flatMap((operation) => operation.lines)
    .join('\n')
  for (const run of runs) {
    expect(pagedOutput).toContain(
      run.result.specification.uri.replace('features/', ''),
    )
  }
  expect(pagedOutput).toContain('more active')
  expect(pagedOutput).toContain('Specifications')
  reporter.fail?.(new Error('Stopped'), 1)
  expect(refreshCancelCount).toBe(1)
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
