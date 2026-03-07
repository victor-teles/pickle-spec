import type { Stagehand } from '@browserbasehq/stagehand'
import { join } from 'path'
import { mkdir } from 'node:fs/promises'
import { sanitize } from './screenshots'

interface TraceFrame {
  data: string       // base64 jpeg from CDP
  timestamp: number  // ms since epoch
}

export interface TraceRecorder {
  stop(): Promise<TraceFrame[]>
  saveFrames(dir: string, stepPrefix: string): Promise<string[]>
}

export async function startStepTrace(stagehand: Stagehand): Promise<TraceRecorder> {
  const page = stagehand.context.pages()[0]!
  const frameId = page.mainFrameId()
  const session = page.getSessionForFrame(frameId)

  const frames: TraceFrame[] = []
  let stopped = false

  const handler = (params: any) => {
    if (stopped) return
    frames.push({ data: params.data, timestamp: Date.now() })
    // Acknowledge to receive next frame
    session.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {})
  }

  session.on('Page.screencastFrame', handler)

  try {
    await session.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      everyNthFrame: 2,
    })
  } catch {
    // If screencast fails to start (e.g. unsupported), return a no-op recorder
    session.off('Page.screencastFrame', handler)
    return {
      async stop() { return [] },
      async saveFrames() { return [] },
    }
  }

  async function stop(): Promise<TraceFrame[]> {
    if (stopped) return frames
    stopped = true
    try {
      await session.send('Page.stopScreencast')
    } catch {}
    session.off('Page.screencastFrame', handler)
    return frames
  }

  async function saveFrames(dir: string, stepPrefix: string): Promise<string[]> {
    if (!stopped) await stop()
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

  return { stop, saveFrames }
}
