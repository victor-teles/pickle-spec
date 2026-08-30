import { createInterface } from 'node:readline'

process.stdout.write(
  `${JSON.stringify({
    version: 5,
    type: 'worker-ready',
    nodeVersion: process.versions.node,
  })}\n`,
)

const lines = createInterface({ input: process.stdin })
for await (const line of lines) {
  const message = JSON.parse(line)
  process.stdout.write(
    `${JSON.stringify({
      version: 5,
      type: 'event',
      payload: {
        type: 'viewport-frame',
        sessionId: 'echo-session',
        frame: { data: 'cG5n', mimeType: 'image/png' },
      },
    })}\n`,
  )
  process.stdout.write(
    `${JSON.stringify({
      version: 5,
      type: 'response',
      id: message.id,
      ok: true,
      payload: {
        version: 5,
        type: 'targets-discovered',
        targets: [],
      },
    })}\n`,
  )
}
