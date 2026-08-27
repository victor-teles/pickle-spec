import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { TestArtifact, TestResultState } from '@pickle-spec/runner'
import type { ScreenshotOptions } from '../adapter/web-options'

export type ArtifactCapturePolicy = 'off' | 'on-failure' | 'always'

export type WebArtifactCapture = {
  screenshots: NonNullable<ScreenshotOptions['mode']>
  recording: boolean
}

export function resolveWebArtifactCapture(input: {
  screenshotMode?: ScreenshotOptions['mode']
  artifactsCapture?: ArtifactCapturePolicy
}): WebArtifactCapture {
  const screenshots =
    input.screenshotMode ??
    (input.artifactsCapture === 'off'
      ? 'off'
      : input.artifactsCapture === 'on-failure'
        ? 'on-failure'
        : 'on-step')
  return {
    screenshots,
    recording: screenshots !== 'off',
  }
}

export async function capturedWebArtifact(
  kind: TestArtifact['kind'],
  path: string,
  mediaType: string,
): Promise<TestArtifact> {
  return {
    kind,
    path,
    mediaType,
    name: basename(path),
    capturedAt: new Date().toISOString(),
    sizeBytes: (await stat(path)).size,
  }
}

export function shouldFinishRecording(
  state: TestResultState,
  stepNumber: number,
  stepCount: number,
): boolean {
  if (state === 'cancelled' || state === 'skipped') return true
  if (state === 'failed' || state === 'infrastructure-error') return true
  return stepNumber >= stepCount
}
