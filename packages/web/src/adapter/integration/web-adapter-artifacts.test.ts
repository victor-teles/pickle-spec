import { afterAll, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebAdapter } from '../../../index'
import { requiredValue } from '../../required-value'
import {
  factoryFor,
  scenario,
  specification,
  stubAutomation,
} from './web-adapter.fixtures.test'

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
