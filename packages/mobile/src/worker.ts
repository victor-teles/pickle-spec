import { createInterface } from 'node:readline'
import { AgentDeviceGateway } from './agent-device-gateway.ts'
import {
  mobileWorkerProtocolVersion,
  workerRequestMessageSchema,
} from './worker-protocol.ts'
import { MobileWorkerRuntime } from './worker-runtime.ts'

const runtime = new MobileWorkerRuntime(new AgentDeviceGateway())
let shuttingDown = false

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function handleLine(line: string): Promise<void> {
  let id: number | undefined
  try {
    const message = workerRequestMessageSchema.parse(JSON.parse(line))
    id = message.id
    const payload = await runtime.handle(message.payload)
    write({
      version: mobileWorkerProtocolVersion,
      type: 'response',
      id,
      ok: true,
      payload,
    })
  } catch (error) {
    if (id === undefined) return
    write({
      version: mobileWorkerProtocolVersion,
      type: 'response',
      id,
      ok: false,
      error: errorMessage(error),
    })
  }
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  await runtime.dispose().catch(() => {})
}

process.once('SIGINT', () => {
  void shutdown().finally(() => process.exit(0))
})
process.once('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0))
})

write({
  version: mobileWorkerProtocolVersion,
  type: 'worker-ready',
  nodeVersion: process.versions.node,
})

const lines = createInterface({ input: process.stdin })
for await (const line of lines) void handleLine(line)
await shutdown()
