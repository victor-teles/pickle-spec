import type { ServerConfig } from './types'
import type { Subprocess } from 'bun'
import { reportServerReused, reportServerStarting, reportServerReady } from './reporter'

export interface ManagedServer {
  process?: Subprocess
  reused?: boolean
  url?: string
  stop: () => void
}

interface ServerRuntime {
  fetch: typeof fetch
  sleep: typeof Bun.sleep
  spawn: typeof Bun.spawn
}

const DEFAULT_RUNTIME: ServerRuntime = {
  fetch,
  sleep: Bun.sleep,
  spawn: Bun.spawn,
}

let serverRuntime: ServerRuntime = DEFAULT_RUNTIME

export function setServerRuntimeForTests(runtime: Partial<ServerRuntime> | null): void {
  serverRuntime = runtime ? { ...DEFAULT_RUNTIME, ...runtime } : DEFAULT_RUNTIME
}

function resolveReadinessUrl(config: ServerConfig): string {
  if (!config.readinessPath || !config.url) {
    return config.url!
  }
  return new URL(config.readinessPath, config.url).toString()
}

function isReadyResponse(config: ServerConfig, response: Response): boolean {
  if (config.readinessPath) {
    return response.status >= 200 && response.status < 400
  }
  return response.ok || response.status < 500
}

async function isHealthy(config: ServerConfig): Promise<boolean> {
  try {
    const response = await serverRuntime.fetch(resolveReadinessUrl(config))
    return isReadyResponse(config, response)
  } catch {
    return false
  }
}

/**
 * Start the dev server and wait for it to be ready.
 */
export async function startServer(config: ServerConfig): Promise<ManagedServer> {
  const command = config.command!
  const url = config.url!
  const pollInterval = config.pollIntervalMs ?? 500

  if (config.reuseExisting && await isHealthy(config)) {
    reportServerReused(url)
    return {
      reused: true,
      url,
      stop: () => {},
    }
  }

  reportServerStarting(command)

  const args = command.split(' ')
  const proc = serverRuntime.spawn(args, {
    stdout: 'ignore',
    stderr: 'pipe',
    cwd: process.cwd(),
  })

  const timeout = config.startupTimeout ?? 30_000
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    if (await isHealthy(config)) {
      reportServerReady(url)
      return {
        process: proc,
        reused: false,
        url,
        stop: () => proc.kill(),
      }
    }
    await serverRuntime.sleep(pollInterval)
  }

  proc.kill()
  throw new Error(
    `Server failed to start within ${timeout}ms. Command: "${command}", URL: "${url}"`,
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
