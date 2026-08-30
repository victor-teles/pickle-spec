import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { MobileWorkerEvent } from '../worker/worker-protocol.ts'
import type { AgentDeviceClientPort } from './agent-device-client.ts'

const screenshotResultSchema = z.object({ path: z.string().min(1) })
const captureIntervalMs = 500
const captureScale = 0.5

export interface MobileViewportController {
  close(): Promise<void>
}

function waitForNextCapture(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timeout = setTimeout(finish, captureIntervalMs)
    signal.addEventListener('abort', finish, { once: true })
  })
}

async function removeCapturedFiles(
  capturedPath: string,
  screenshotPath: string,
): Promise<void> {
  if (capturedPath !== screenshotPath) {
    await unlink(capturedPath).catch(() => {})
  }
  await unlink(screenshotPath).catch(() => {})
}

async function captureViewportFrame(input: {
  client: AgentDeviceClientPort
  screenshotPath: string
  sessionId: string
  signal: AbortSignal
}): Promise<MobileWorkerEvent | undefined> {
  let capturedPath = input.screenshotPath
  try {
    const result = screenshotResultSchema.parse(
      await input.client.capture.screenshot({
        path: input.screenshotPath,
        scale: captureScale,
        stabilize: false,
      }),
    )
    capturedPath = result.path
    if (input.signal.aborted) return
    const data = (await readFile(capturedPath)).toString('base64')
    if (input.signal.aborted) return
    return {
      type: 'viewport-frame',
      sessionId: input.sessionId,
      frame: { data, mimeType: 'image/png' },
    }
  } finally {
    await removeCapturedFiles(capturedPath, input.screenshotPath)
  }
}

export function startAgentDeviceViewport(input: {
  sessionId: string
  client: AgentDeviceClientPort
  publish: (event: MobileWorkerEvent) => void
}): MobileViewportController {
  const controller = new AbortController()
  const screenshotPath = join(
    tmpdir(),
    `pickle-spec-device-${crypto.randomUUID()}.png`,
  )
  const capture = async () => {
    while (!controller.signal.aborted) {
      const frame = await captureViewportFrame({
        client: input.client,
        screenshotPath,
        sessionId: input.sessionId,
        signal: controller.signal,
      }).catch(() => undefined)
      if (frame) input.publish(frame)
      await waitForNextCapture(controller.signal)
    }
  }
  const capturePromise = capture()
  let closePromise: Promise<void> | undefined
  return {
    close() {
      closePromise ??= (async () => {
        controller.abort()
        await capturePromise
        await unlink(screenshotPath).catch(() => {})
        input.publish({
          type: 'viewport-closed',
          sessionId: input.sessionId,
        })
      })()
      return closePromise
    },
  }
}
