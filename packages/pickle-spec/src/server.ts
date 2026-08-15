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

function shellCommand(command: string): string[] {
  return process.platform === 'win32'
    ? ['cmd.exe', '/d', '/s', '/c', command]
    : ['/bin/sh', '-c', command]
}

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

async function isHealthy(config: ServerConfig, deadline: number): Promise<boolean> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return false

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), remaining)
  try {
    const response = await serverRuntime.fetch(resolveReadinessUrl(config), {
      signal: controller.signal,
    })
    return Date.now() < deadline && isReadyResponse(config, response)
  } catch {
    return false
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Start the dev server and wait for it to be ready.
 */
export async function startServer(config: ServerConfig): Promise<ManagedServer> {
  const command = config.command!
  const url = config.url!
  const pollInterval = config.pollIntervalMs ?? 500
  const timeout = config.startupTimeout ?? 30_000
  const deadline = Date.now() + timeout

  if (config.reuseExisting && await isHealthy(config, deadline)) {
    reportServerReused(url)
    return {
      reused: true,
      url,
      stop: () => {},
    }
  }

  if (Date.now() >= deadline) {
    throw new Error(
      `Server failed to start within ${timeout}ms. Command: "${command}", URL: "${url}"`,
    )
  }

  reportServerStarting(command)

  const proc = serverRuntime.spawn(shellCommand(command), {
    stdout: 'ignore',
    stderr: 'pipe',
    cwd: process.cwd(),
  })

  while (Date.now() < deadline) {
    if (await isHealthy(config, deadline)) {
      reportServerReady(url)
      return {
        process: proc,
        reused: false,
        url,
        stop: () => proc.kill(),
      }
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await serverRuntime.sleep(Math.min(pollInterval, remaining))
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
