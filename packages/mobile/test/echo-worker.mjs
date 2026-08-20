import { createInterface } from 'node:readline'

process.stdout.write(
  `${JSON.stringify({
    version: 2,
    type: 'worker-ready',
    nodeVersion: process.versions.node,
  })}\n`,
)

const lines = createInterface({ input: process.stdin })
for await (const line of lines) {
  const message = JSON.parse(line)
  process.stdout.write(
    `${JSON.stringify({
      version: 2,
      type: 'response',
      id: message.id,
      ok: true,
      payload: {
        version: 2,
        type: 'targets-discovered',
        targets: [],
      },
    })}\n`,
  )
}
