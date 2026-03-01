import type { ServerConfig } from './types'
import type { Subprocess } from 'bun'
import { reportServerStarting, reportServerReady } from './reporter'

export interface ManagedServer {
  process: Subprocess
  stop: () => void
}

/**
 * Start the dev server and wait for it to be ready.
 */
export async function startServer(config: ServerConfig): Promise<ManagedServer> {
  reportServerStarting(config.command)

  const args = config.command.split(' ')
  const proc = Bun.spawn(args, {
    stdout: 'ignore',
    stderr: 'pipe',
    cwd: process.cwd(),
  })

  const timeout = config.startupTimeout ?? 30_000
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(config.url)
      if (response.ok || response.status < 500) {
        reportServerReady(config.url)
        return {
          process: proc,
          stop: () => proc.kill(),
        }
      }
    } catch {
      // Server not ready yet
    }
    await Bun.sleep(500)
  }

  proc.kill()
  throw new Error(
    `Server failed to start within ${timeout}ms. Command: "${config.command}", URL: "${config.url}"`,
  )
}

/**
 * Stop the managed server process.
 */
export function stopServer(server: ManagedServer): void {
  try {
    server.stop()
  } catch {
    // Process may already be dead
  }
}
