import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runScenario } from '@pickle-spec/runner'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { createWebAdapter } from '../../../../index'
import { requiredValue } from '../../../../src/required-value'
import { factoryFor, scenario, specification, stubAutomation } from './fixtures'

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
    const navigate = vi.fn(async () => {})
    const observe = vi.fn(async () => [
      { description: 'Fill the search field', handle: { selector: '#search' } },
    ])
    const act = vi.fn(async () => ({ success: true }))
    const verify = vi.fn(async () => ({
      meetsExpectation: false,
      actualState: 'No results were shown',
    }))
    const close = vi.fn(async () => {})
    const adapter = createWebAdapter(
      {
        baseUrl: 'https://example.test',
        screenshots: { mode: 'on-step', outputDir: artifactDirectory },
      },
      factoryFor(
        stubAutomation({
          navigate,
          observe,
          act,
          verify,
          async screenshot() {
            return new Uint8Array([137, 80, 78, 71])
          },
          close,
        }),
      ),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })

    const navigation = await session.executeStep(
      requiredValue(scenario.steps[0]),
    )
    const action = await session.executeStep(requiredValue(scenario.steps[1]))
    const outcome = await session.executeStep(requiredValue(scenario.steps[2]))
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
    expect(
      await Bun.file(
        requiredValue(requiredValue(navigation.artifacts)[0]).path,
      ).exists(),
    ).toBe(true)
    expect(observe).toHaveBeenCalledTimes(1)
    expect(act).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('reuses the final action screenshot at step completion', async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'pickle-web-action-artifacts-'),
    )
    artifactDirectories.push(artifactDirectory)
    const screenshot = vi.fn(async () => new Uint8Array([137, 80, 78, 71]))
    const adapter = createWebAdapter(
      {
        baseUrl: 'https://example.test',
        screenshots: { mode: 'on-step', outputDir: artifactDirectory },
      },
      factoryFor(
        stubAutomation({
          async observe() {
            return [
              {
                description: 'Fill the search field',
                handle: { selector: '#search' },
              },
            ]
          },
          screenshot,
        }),
      ),
    )

    const run = await runScenario({
      adapter,
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })
    await adapter.dispose?.()
    const finished = run.events.findLast(
      (event) => event.type === 'scenario-finished',
    )
    if (finished?.type !== 'scenario-finished') {
      throw new Error('Expected completed Scenario evidence')
    }
    const actionStep = requiredValue(finished.attempt.steps[1])
    const resolvedAction = requiredValue(actionStep.resolvedActions[0])
    const action = requiredValue(resolvedAction.evidence)
    const after = action.screenshots.after
    const before = action.screenshots.before
    if (before.state !== 'available' || after.state !== 'available') {
      throw new Error('Expected before-and-after action screenshots')
    }

    expect(screenshot).toHaveBeenCalledTimes(6)
    expect(actionStep.artifacts).toHaveLength(2)
    expect(actionStep.artifacts?.[0]?.path).toBe(after.artifact.path)
    expect(actionStep.artifacts?.map((artifact) => artifact.path)).toEqual(
      expect.arrayContaining([before.artifact.path, after.artifact.path]),
    )
    expect(
      new Set(actionStep.artifacts?.map((artifact) => artifact.path)).size,
    ).toBe(2)
  })

  test('attaches screenshots to each step and the recording to the failing step', async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'pickle-web-recording-'),
    )
    artifactDirectories.push(artifactDirectory)
    let recordingPath = ''
    const adapter = createWebAdapter(
      {
        baseUrl: 'https://example.test',
        screenshots: { mode: 'on-step', outputDir: artifactDirectory },
      },
      factoryFor(
        stubAutomation({
          async observe() {
            return [
              {
                description: 'Fill the search field',
                handle: { selector: '#search' },
              },
            ]
          },
          async verify() {
            return {
              meetsExpectation: false,
              actualState: 'No results were shown',
            }
          },
          async screenshot() {
            return new Uint8Array([137, 80, 78, 71])
          },
          async startRecording(path) {
            recordingPath = path
            await Bun.write(path, 'video-bytes')
          },
          async stopRecording() {
            return {
              kind: 'recording',
              path: recordingPath,
              mediaType: 'video/mp4',
              name: 'scenario.mp4',
            }
          },
        }),
      ),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })
    const navigation = await session.executeStep(
      requiredValue(scenario.steps[0]),
    )
    const action = await session.executeStep(requiredValue(scenario.steps[1]))
    const outcome = await session.executeStep(requiredValue(scenario.steps[2]))
    await session.close()

    expect(navigation.artifacts?.map((artifact) => artifact.kind)).toEqual([
      'screenshot',
    ])
    expect(action.artifacts?.map((artifact) => artifact.kind)).toEqual([
      'screenshot',
    ])
    expect(outcome.artifacts?.map((artifact) => artifact.kind)).toEqual([
      'screenshot',
      'recording',
    ])
    expect(outcome.evidenceAvailability).toContainEqual({
      kind: 'recording',
      state: 'available',
    })
    expect(recordingPath).toContain(artifactDirectory)
    expect(await Bun.file(recordingPath).exists()).toBe(true)
  })

  test('attaches the recording to the last passed step', async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'pickle-web-recording-pass-'),
    )
    artifactDirectories.push(artifactDirectory)
    let recordingPath = ''
    const adapter = createWebAdapter(
      {
        baseUrl: 'https://example.test',
        screenshots: { mode: 'on-step', outputDir: artifactDirectory },
      },
      factoryFor(
        stubAutomation({
          async observe() {
            return [
              {
                description: 'Fill the search field',
                handle: { selector: '#search' },
              },
            ]
          },
          async screenshot() {
            return new Uint8Array([137, 80, 78, 71])
          },
          async startRecording(path) {
            recordingPath = path
            await Bun.write(path, 'video-bytes')
          },
          async stopRecording() {
            return {
              kind: 'recording',
              path: recordingPath,
              mediaType: 'video/mp4',
              name: 'scenario.mp4',
            }
          },
        }),
      ),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })
    const navigation = await session.executeStep(
      requiredValue(scenario.steps[0]),
    )
    const action = await session.executeStep(requiredValue(scenario.steps[1]))
    const outcome = await session.executeStep(requiredValue(scenario.steps[2]))
    await session.close()

    expect(navigation.artifacts?.map((artifact) => artifact.kind)).toEqual([
      'screenshot',
    ])
    expect(action.artifacts?.map((artifact) => artifact.kind)).toEqual([
      'screenshot',
    ])
    expect(outcome.state).toBe('passed')
    expect(outcome.artifacts?.map((artifact) => artifact.kind)).toEqual([
      'screenshot',
      'recording',
    ])
  })

  test('reports a recording start failure once', async () => {
    const adapter = createWebAdapter(
      {
        baseUrl: 'https://example.test',
        screenshots: { mode: 'on-step' },
      },
      factoryFor(
        stubAutomation({
          async startRecording() {
            throw new Error('encoder unavailable')
          },
        }),
      ),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })

    const results = []
    for (const step of scenario.steps) {
      results.push(await session.executeStep(step))
    }
    await session.close()

    expect(
      results.flatMap((result) => result.evidenceAvailability ?? []),
    ).toContainEqual({
      kind: 'recording',
      state: 'capture-failed',
      message: 'encoder unavailable',
    })
    expect(
      results
        .flatMap((result) => result.evidenceAvailability ?? [])
        .filter((availability) => availability.kind === 'recording'),
    ).toHaveLength(1)
  })

  test('reports a requested screenshot that could not be captured', async () => {
    const adapter = createWebAdapter(
      {
        baseUrl: 'https://example.test',
        screenshots: { mode: 'on-step' },
      },
      factoryFor(
        stubAutomation({
          async screenshot() {
            throw new Error('browser page closed')
          },
        }),
      ),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })

    const result = await session.executeStep(requiredValue(scenario.steps[0]))
    await session.close()

    expect(result.artifacts).toBeUndefined()
    expect(result.evidenceAvailability).toContainEqual({
      kind: 'screenshot',
      state: 'capture-failed',
      message: 'Screenshot capture failed',
    })
  })
})
