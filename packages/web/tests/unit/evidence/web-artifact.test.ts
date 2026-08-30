import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  capturedWebArtifact,
  resolveWebArtifactCapture,
  shouldFinishRecording,
} from '../../../src/evidence/web-artifact'

test('defaults a stock web run to screenshots on passed and failed steps plus recording', () => {
  expect(resolveWebArtifactCapture({})).toEqual({
    screenshots: 'on-step',
    recording: true,
  })
})

test('maps artifacts.capture onto screenshot mode and recording', () => {
  expect(resolveWebArtifactCapture({ artifactsCapture: 'off' })).toEqual({
    screenshots: 'off',
    recording: false,
  })
  expect(resolveWebArtifactCapture({ artifactsCapture: 'on-failure' })).toEqual(
    {
      screenshots: 'on-failure',
      recording: true,
    },
  )
  expect(resolveWebArtifactCapture({ artifactsCapture: 'always' })).toEqual({
    screenshots: 'on-step',
    recording: true,
  })
})

test('lets an explicit screenshot mode win over artifacts.capture', () => {
  expect(
    resolveWebArtifactCapture({
      screenshotMode: 'off',
      artifactsCapture: 'always',
    }),
  ).toEqual({
    screenshots: 'off',
    recording: false,
  })
})

test('finishes the recording on the last passed step or any failing step', () => {
  expect(shouldFinishRecording('passed', 2, 3)).toBe(false)
  expect(shouldFinishRecording('passed', 3, 3)).toBe(true)
  expect(shouldFinishRecording('failed', 1, 3)).toBe(true)
  expect(shouldFinishRecording('infrastructure-error', 2, 3)).toBe(true)
  expect(shouldFinishRecording('cancelled', 1, 3)).toBe(true)
})

test('records screenshot metadata from the captured file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pickle-web-artifact-'))
  const path = join(directory, 'step-01-passed.png')
  await Bun.write(path, 'png-bytes')
  try {
    const artifact = await capturedWebArtifact('screenshot', path, 'image/png')
    expect(artifact).toMatchObject({
      kind: 'screenshot',
      path,
      mediaType: 'image/png',
      name: 'step-01-passed.png',
      sizeBytes: 9,
    })
    expect(artifact.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
