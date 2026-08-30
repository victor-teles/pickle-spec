import { createInterface } from 'node:readline'
import { AgentDeviceGateway } from '../agent-device/agent-device-gateway.ts'
import {
  type MobileWorkerEvent,
  mobileWorkerProtocolVersion,
  workerRequestMessageSchema,
} from './worker-protocol.ts'
import { MobileWorkerRuntime } from './worker-runtime.ts'

let shuttingDown = false

class WorkerOutput {
  private readonly responses: string[] = []
  private readonly viewportEvents = new Map<string, string>()
  private flushing = false

  response(message: unknown): void {
    this.responses.push(`${JSON.stringify(message)}\n`)
    void this.flush()
  }

  event(event: MobileWorkerEvent): void {
    this.viewportEvents.set(
      event.sessionId,
      `${JSON.stringify({
        version: mobileWorkerProtocolVersion,
        type: 'event',
        payload: event,
      })}\n`,
    )
    void this.flush()
  }

  private nextMessage(): string | undefined {
    const response = this.responses.shift()
    if (response) return response
    const eventEntry = this.viewportEvents.entries().next().value
    if (!eventEntry) return
    this.viewportEvents.delete(eventEntry[0])
    return eventEntry[1]
  }

  private write(message: string): Promise<void> | undefined {
    if (process.stdout.write(message)) return
    return new Promise((resolve) => process.stdout.once('drain', resolve))
  }

  private async flush(): Promise<void> {
    if (this.flushing) return
    this.flushing = true
    try {
      while (this.responses.length > 0 || this.viewportEvents.size > 0) {
        const message = this.nextMessage()
        if (!message) return
        await this.write(message)
      }
    } finally {
      this.flushing = false
      if (this.responses.length > 0 || this.viewportEvents.size > 0) {
        void this.flush()
      }
    }
  }
}

const output = new WorkerOutput()
const runtime = new MobileWorkerRuntime(
  new AgentDeviceGateway(undefined, (event) => output.event(event)),
)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function handleLine(line: string): Promise<void> {
  let id: number | undefined
  try {
    const message = workerRequestMessageSchema.parse(JSON.parse(line))
    id = message.id
    const payload = await runtime.handle(message.payload)
    output.response({
      version: mobileWorkerProtocolVersion,
      type: 'response',
      id,
      ok: true,
      payload,
    })
  } catch (error) {
    if (id === undefined) return
    output.response({
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

output.response({
  version: mobileWorkerProtocolVersion,
  type: 'worker-ready',
  nodeVersion: process.versions.node,
})

const lines = createInterface({ input: process.stdin })
for await (const line of lines) void handleLine(line)
await shutdown()
