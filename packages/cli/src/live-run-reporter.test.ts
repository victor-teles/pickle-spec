import { expect, test } from 'bun:test'
import { createRunReporter } from './run-reporter'
import {
  finishReporter,
  passedRun,
  recordingTerminal,
} from './run-reporter.test-support'

test('shows completed and running Gherkin steps beneath an active Scenario', () => {
  const run = passedRun({
    specificationUri: 'features/search.feature',
    specificationName: 'Search',
    scenarioId: 'scenario-search',
    scenarioName: 'Search for images',
    profileId: 'web',
    durationMs: 10,
  })
  const terminal = recordingTerminal(() => 120)
  const reporter = createRunReporter('default', {
    terminal: terminal.surface,
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: true,
  })
  const contextStep = {
    keyword: 'Given',
    text: 'the search page is open',
    type: 'context' as const,
  }
  const actionStep = {
    keyword: 'When',
    text: 'I search for images',
    type: 'action' as const,
  }

  reporter.start()
  reporter.prepare?.([
    {
      specification: run.result.specification,
      scenario: run.result.scenario,
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
  reporter.event({
    schemaVersion: 1,
    sequence: 2,
    type: 'step-started',
    step: contextStep,
    scenario: run.result.scenario,
    executionTargetProfile: run.result.executionTargetProfile,
  })
  reporter.event({
    schemaVersion: 1,
    sequence: 3,
    type: 'step-finished',
    result: {
      step: contextStep,
      state: 'passed',
      resolvedActions: [],
    },
    scenario: run.result.scenario,
    executionTargetProfile: run.result.executionTargetProfile,
  })
  reporter.event({
    schemaVersion: 1,
    sequence: 4,
    type: 'step-started',
    step: actionStep,
    scenario: run.result.scenario,
    executionTargetProfile: run.result.executionTargetProfile,
  })

  const frame = terminal.operations.at(-1)
  expect(frame?.type).toBe('update')
  expect(frame?.lines.join('\n')).toContain('Search for images')
  expect(frame?.lines.join('\n')).toContain(
    '\u001b[32m✓\u001b[39m Given the search page is open',
  )
  expect(frame?.lines.join('\n')).toContain('When I search for images')
})

test('commits each completed Test result while its Specification is still running', () => {
  const runs = [
    passedRun({
      specificationUri: 'features/checkout.feature',
      specificationName: 'Checkout',
      scenarioId: 'scenario-first',
      scenarioName: 'First Scenario',
      profileId: 'web',
      durationMs: 10,
    }),
    passedRun({
      specificationUri: 'features/checkout.feature',
      specificationName: 'Checkout',
      scenarioId: 'scenario-second',
      scenarioName: 'Second Scenario',
      profileId: 'web',
      durationMs: 20,
    }),
  ]
  const terminal = recordingTerminal(() => 120)
  const reporter = createRunReporter('default', {
    terminal: terminal.surface,
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  })

  reporter.start()
  reporter.prepare?.(
    runs.map(({ result }) => ({
      specification: result.specification,
      scenario: result.scenario,
      executionTargetProfile: result.executionTargetProfile,
    })),
  )
  reporter.complete?.(runs[0]!.result)

  const committedOutput = terminal.operations
    .filter((operation) => operation.type === 'commit')
    .flatMap((operation) => operation.lines)
    .join('\n')
  expect(committedOutput).toContain(
    'features/checkout.feature > First Scenario [10ms]',
  )
  expect(committedOutput).not.toContain('Second Scenario')
})

test('updates active Specifications and commits each completed result once', () => {
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
  expect(initialFrame?.lines.join('\n')).toContain('First Scenario')
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
  expect(concurrentFrame?.lines.join('\n')).not.toContain('features/a.feature')
  expect(concurrentFrame?.lines.join('\n')).not.toContain('First Scenario')
  expect(concurrentFrame?.lines.join('\n')).toContain('features/b.feature')
  expect(concurrentFrame?.lines.join('\n')).toContain('0/1 Test result')
  expect(concurrentFrame?.lines.join('\n')).toContain('Other active Scenario')
  expect(
    terminal.operations
      .filter((operation) => operation.type === 'commit')
      .flatMap((operation) => operation.lines)
      .join('\n'),
  ).toContain('features/a.feature > First Scenario [10ms]')

  for (const run of runs.slice(1, 4)) reporter.complete?.(run.result)

  const commits = terminal.operations.filter(
    (operation) => operation.type === 'commit',
  )
  expect(commits).toHaveLength(5)
  expect(commits[0]?.lines.join('\n')).toContain('RUN  pickle 1.0.2')
  expect(commits[1]?.lines.join('\n')).toContain('features/a.feature')
  expect(commits[4]?.lines.join('\n')).toContain(
    'features/a.feature > Second Scenario [40ms]',
  )
  expect(terminal.operations.at(-1)?.lines.join('\n')).toContain(
    'features/b.feature',
  )

  reporter.complete?.(runs[4]!.result)
  finishReporter(reporter, runs, 50)

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

test('finishes live progress with actionable diagnostics and a compact result tree', () => {
  const run = passedRun({
    specificationUri: 'features/checkout.feature',
    specificationName: 'Checkout',
    scenarioId: 'scenario-purchase',
    scenarioName: 'Complete a purchase',
    profileId: 'web',
    durationMs: 10,
  })
  run.result.state = 'failed'
  run.result.message = 'Expected confirmation\nbut the page remained empty'
  run.result.steps = [
    {
      step: {
        keyword: 'Then',
        text: 'the purchase succeeds',
        type: 'outcome',
      },
      state: 'failed',
      resolvedActions: [{ description: 'Inspect internal selectors' }],
      message: 'Expected confirmation\nbut the page remained empty',
    },
  ]
  const terminal = recordingTerminal(() => 120)
  const reporter = createRunReporter('default', {
    terminal: terminal.surface,
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  })

  reporter.start()
  finishReporter(reporter, [run], 10)

  const committedOutput = terminal.operations
    .filter((operation) => operation.type === 'commit')
    .flatMap((operation) => operation.lines)
    .join('\n')
  const finalOutput = terminal.operations
    .filter((operation) => operation.type === 'finish')
    .flatMap((operation) => operation.lines)
    .join('\n')
  expect(committedOutput).toContain(
    '× features/checkout.feature > Complete a purchase [10ms] (failed)',
  )
  expect(committedOutput).not.toContain('Expected confirmation')
  expect(finalOutput).toContain(` Failures

 × Failure
   Specification  Checkout (features/checkout.feature)
   Scenario       Complete a purchase
   Steps
     × Then the purchase succeeds
       Expected confirmation
       but the page remained empty`)
  expect(finalOutput).not.toContain('Inspect internal selectors')
  expect(finalOutput).not.toMatch(/[◐◓◑◒]/u)
})

test('finishes live progress with a prominent adaptation-policy rejection', () => {
  const run = passedRun({
    specificationUri: 'features/checkout.feature',
    specificationName: 'Checkout',
    scenarioId: 'scenario-purchase',
    scenarioName: 'Complete a purchase',
    profileId: 'web',
    durationMs: 10,
  })
  run.result.state = 'passed-with-adaptation'
  const terminal = recordingTerminal(() => 120)
  const reporter = createRunReporter('default', {
    terminal: terminal.surface,
    projectRoot: '/workspace/project',
    version: '1.0.2',
    color: false,
    now: () => new Date(2026, 7, 20, 14, 32, 7),
  })

  reporter.start()
  reporter.finish([run], 10, {
    exitCode: 1,
    interrupted: false,
    rejectedAdaptedResults: 1,
  })

  const finalOutput = terminal.operations
    .filter((operation) => operation.type === 'finish')
    .flatMap((operation) => operation.lines)
    .join('\n')
  expect(finalOutput).toContain('! Adaptation policy rejected the Test run')
  expect(finalOutput).toContain(
    'The Test result remains adapted and pickle run exits with code 1.',
  )
})

test('rewraps active progress and preserves a committed result on resize', () => {
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
  reporter.event({
    schemaVersion: 1,
    sequence: 2,
    type: 'scenario-started',
    scenario: { id: 'scenario-pending', name: 'Still pending' },
    executionTargetProfile: run.result.executionTargetProfile,
  })

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
  expect(
    terminal.operations
      .filter((operation) => operation.type === 'commit')
      .flatMap((operation) => operation.lines)
      .join(' ')
      .replace(/\s+/gu, ' '),
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

test('keeps every active Specification visible within the terminal bounds', () => {
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
    reporter.event({
      schemaVersion: 1,
      sequence: 2,
      type: 'scenario-started',
      scenario: specificationRuns[5]!.result.scenario,
      executionTargetProfile:
        specificationRuns[5]!.result.executionTargetProfile,
    })
  }

  const frame = terminal.operations.at(-1)
  expect(frame?.type).toBe('update')
  expect(frame?.lines.length).toBeLessThanOrEqual(10)
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
