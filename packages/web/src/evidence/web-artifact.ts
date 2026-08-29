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
  let screenshots = input.screenshotMode
  if (!screenshots) {
    screenshots = input.artifactsCapture === 'off' ? 'off' : 'on-step'
    if (input.artifactsCapture === 'on-failure') screenshots = 'on-failure'
  }
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
