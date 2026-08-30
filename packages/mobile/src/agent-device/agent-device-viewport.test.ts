import { writeFile } from 'node:fs/promises'
import { expect, test } from 'vitest'
import type { AgentDeviceClientPort } from './agent-device-client'
import { startAgentDeviceViewport } from './agent-device-viewport'

test('captures one frame at a time and closes exactly once', async () => {
  let activeCaptures = 0
  let maximumActiveCaptures = 0
  const events: Array<{ type: string }> = []
  const firstFrame = Promise.withResolvers<void>()
  const client = {
    capture: {
      async screenshot(options: { path?: string }) {
        activeCaptures++
        maximumActiveCaptures = Math.max(maximumActiveCaptures, activeCaptures)
        await writeFile(options.path ?? '', 'png')
        activeCaptures--
        return { path: options.path }
      },
    },
  } as AgentDeviceClientPort
  const viewport = startAgentDeviceViewport({
    sessionId: 'session-1',
    client,
    publish(event) {
      events.push(event)
      if (event.type === 'viewport-frame') firstFrame.resolve()
    },
  })

  await firstFrame.promise
  await Promise.all([viewport.close(), viewport.close()])

  expect(maximumActiveCaptures).toBe(1)
  expect(events).toEqual([
    expect.objectContaining({
      type: 'viewport-frame',
      sessionId: 'session-1',
      frame: expect.objectContaining({ mimeType: 'image/png' }),
    }),
    { type: 'viewport-closed', sessionId: 'session-1' },
  ])
})
