import type { Stagehand } from '@browserbasehq/stagehand'
import { join } from 'path'
import { mkdir } from 'node:fs/promises'

interface TraceFrame {
  data: string       // base64 jpeg from CDP
  timestamp: number  // ms since epoch
}

export interface TraceRecorder {
  stop(): Promise<TraceFrame[]>
  saveFrames(dir: string, stepPrefix: string): Promise<string[]>
}

/**
 * Stagehand v4 no longer exposes Playwright-style CDP screencast helpers.
 * Keep the public seam so reports still generate; return a no-op recorder.
 */
export async function startStepTrace(_stagehand: Stagehand): Promise<TraceRecorder> {
  return {
    async stop() { return [] },
    async saveFrames() { return [] },
  }
}

/** @internal retained for tests that write frames manually */
export async function writeTraceFrames(
  frames: TraceFrame[],
  dir: string,
  stepPrefix: string,
): Promise<string[]> {
  if (frames.length === 0) return []
  await mkdir(dir, { recursive: true })
  const paths: string[] = []
  for (let i = 0; i < frames.length; i++) {
    const filename = `${stepPrefix}-frame-${String(i).padStart(4, '0')}.jpeg`
    const filePath = join(dir, filename)
    await Bun.write(filePath, Buffer.from(frames[i]!.data, 'base64'))
    paths.push(filePath)
  }
  return paths
}
