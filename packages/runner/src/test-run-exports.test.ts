import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  openTestRunStore,
  projectAllureResults,
  publishTestRunExports,
  resolveLocalProjectStorage,
  type TestResult,
  type TestRunManifest,
} from '../index'

const startedAt = '2026-08-15T12:00:01.000Z'
const finishedAt = '2026-08-15T12:00:02.000Z'

function manifest(artifactPath: string): TestRunManifest {
  const failedAttempt: TestResult['attempts'][number] = {
    attempt: 1,
    startedAt,
    finishedAt,
    durationMs: 1_000,
    state: 'failed',
    message: 'Payment was declined',
    steps: [
      {
        index: 0,
        startedAt,
        finishedAt,
        durationMs: 1_000,
        step: { keyword: 'Then', text: 'payment is captured', type: 'outcome' },
        state: 'failed',
        message: 'Payment was declined',
        resolvedActions: [{ description: 'Inspect payment status' }],
        artifacts: [
          { kind: 'screenshot', path: artifactPath, mediaType: 'image/png' },
        ],
      },
    ],
    evidenceAvailability: [
      { kind: 'screenshot', state: 'available' },
      { kind: 'trace', state: 'not-supported' },
      { kind: 'recording', state: 'not-supported' },
      { kind: 'device-log', state: 'not-supported' },
      { kind: 'diagnostics', state: 'not-supported' },
    ],
  }
  const passedAttempt = {
    ...failedAttempt,
    attempt: 2,
    state: 'passed' as const,
    message: undefined,
    steps: [],
    evidenceAvailability: failedAttempt.evidenceAvailability.map(
      (availability) =>
        availability.kind === 'screenshot'
          ? { ...availability, state: 'not-retained' as const }
          : availability,
    ),
  }
  return {
    schemaVersion: 2,
    id: 'run-exports',
    startedAt,
    finishedAt,
    state: 'passed',
    results: [
      {
        schemaVersion: 2,
        specification: {
          name: 'Checkout',
          uri: 'features/checkout.feature',
        },
        scenario: {
          name: 'Pay for the order',
          id: 'scnpaybbbbbbbbbb',
          examplesRowId: 'row-card',
        },
        executionTargetProfile: { id: 'chrome' },
        state: 'passed',
        startedAt,
        finishedAt,
        durationMs: 1_000,
        attempts: [failedAttempt, passedAttempt],
        flaky: true,
      },
    ],
  }
}

test('projects every Scenario attempt to common-core Allure result files', () => {
  const projected = projectAllureResults(manifest('/run/artifacts/failure.png'))

  expect(projected.results).toHaveLength(2)
  expect(projected.results[0]?.result).toMatchObject({
    testCaseId: 'scnpaybbbbbbbbbb',
    name: 'Pay for the order',
    status: 'failed',
    stage: 'finished',
    statusDetails: { message: 'Payment was declined', flaky: true },
    parameters: [
      { name: 'examplesRowId', value: 'row-card' },
      { name: 'executionTargetProfile', value: 'chrome' },
      { name: 'attempt', value: '1', excluded: true },
    ],
  })
  expect(projected.results[0]?.result.steps[0]).toMatchObject({
    name: 'Then payment is captured',
    status: 'failed',
    steps: [{ name: 'Inspect payment status', status: 'passed' }],
  })
  expect(projected.results[0]?.result.attachments).toHaveLength(1)
  expect(projected.results[0]?.result.historyId).toBe(
    projected.results[1]?.result.historyId,
  )
  expect(projected.results[0]?.result.uuid).not.toBe(
    projected.results[1]?.result.uuid,
  )
  expect(projected.attachments).toEqual([
    {
      sourcePath: '/run/artifacts/failure.png',
      fileName: expect.stringMatching(/-attachment\.png$/),
    },
  ])
})

test('publishes requested outputs independently without replacing destinations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pickle-exports-'))
  const pickleHome = join(root, '.pickle-home')
  try {
    const sourceArtifact = join(root, 'failure.png')
    await Bun.write(sourceArtifact, 'png-bytes')
    const canonical = manifest(sourceArtifact)
    const store = openTestRunStore({
      root,
      pickleHome,
      createId: () => canonical.id,
      artifactCapture: 'always',
      now: () => new Date(finishedAt),
    })
    const run = await store.create()
    await run.append({
      type: 'run-started',
      run: { id: run.id, startedAt },
    })
    for (const result of canonical.results) {
      for (const attempt of result.attempts) {
        await run.append({
          type: 'scenario-finished',
          specification: result.specification,
          scenario: result.scenario,
          executionTargetProfile: result.executionTargetProfile,
          scope: {
            scenarioId: result.scenario.id!,
            examplesRowId: result.scenario.examplesRowId,
            executionTargetProfileId: result.executionTargetProfile.id,
            attempt: attempt.attempt,
          },
          attempt,
        })
      }
    }
    await run.materialize()

    const outputsDirectory = join(root, 'outputs')
    await mkdir(outputsDirectory)
    const jsonPath = join(outputsDirectory, 'run.json')
    const ndjsonPath = join(outputsDirectory, 'events.ndjson')
    const occupiedPath = join(outputsDirectory, 'run.xml')
    const htmlPath = join(outputsDirectory, 'run.html')
    const archivePath = join(outputsDirectory, 'run.archive.json')
    const allurePath = join(outputsDirectory, 'allure-results')
    await Bun.write(occupiedPath, 'keep-me')
    const runDirectory = join(
      resolveLocalProjectStorage(root, pickleHome).runsDirectory,
      run.id,
    )
    const manifestBefore = await Bun.file(
      join(runDirectory, 'manifest.json'),
    ).text()
    const eventsBefore = await Bun.file(
      join(runDirectory, 'events.ndjson'),
    ).text()

    const outcomes = await publishTestRunExports({
      root,
      pickleHome,
      runId: run.id,
      outputs: [
        { format: 'json', path: jsonPath },
        { format: 'ndjson', path: ndjsonPath },
        { format: 'junit', path: occupiedPath },
        { format: 'html', path: htmlPath },
        { format: 'archive', path: archivePath },
        { format: 'allure', path: allurePath },
      ],
    })

    expect(outcomes.map(({ status }) => status)).toEqual([
      'succeeded',
      'succeeded',
      'failed',
      'succeeded',
      'succeeded',
      'succeeded',
    ])
    expect(await Bun.file(occupiedPath).text()).toBe('keep-me')
    expect(await Bun.file(jsonPath).json()).toMatchObject({ id: run.id })
    expect([
      ...new Bun.Glob('*-result.json').scanSync({ cwd: allurePath }),
    ]).toHaveLength(2)
    expect([
      ...new Bun.Glob('*-attachment.png').scanSync({ cwd: allurePath }),
    ]).toHaveLength(1)
    expect(await Bun.file(ndjsonPath).text()).toContain('"type":"run-started"')
    expect(await Bun.file(htmlPath).text()).toContain('<!DOCTYPE html>')
    expect(await Bun.file(archivePath).json()).toMatchObject({
      kind: 'run-archive',
    })

    await Bun.write(jsonPath, 'replace-me')
    const forced = await publishTestRunExports({
      root,
      pickleHome,
      runId: run.id,
      force: true,
      outputs: [
        { format: 'json', path: jsonPath },
        { format: 'allure', path: allurePath },
      ],
    })
    expect(forced.map(({ status }) => status)).toEqual([
      'succeeded',
      'succeeded',
    ])
    expect(await Bun.file(jsonPath).json()).toMatchObject({ id: run.id })
    expect(await Bun.file(join(runDirectory, 'manifest.json')).text()).toBe(
      manifestBefore,
    )
    expect(await Bun.file(join(runDirectory, 'events.ndjson')).text()).toBe(
      eventsBefore,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
