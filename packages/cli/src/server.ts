import type { ServerConfig } from './config'
import type { Subprocess } from 'bun'

export interface ManagedServer {
  mode: 'spawned' | 'reused'
  url: string
  stop(): void
}

export interface ServerRuntime {
  fetch: typeof fetch
  sleep: typeof Bun.sleep
  spawn: typeof Bun.spawn
}

const runtime: ServerRuntime = { fetch, sleep: Bun.sleep, spawn: Bun.spawn }

function commandForShell(command: string): string[] {
  return process.platform === 'win32'
    ? ['cmd.exe', '/d', '/s', '/c', command]
    : ['/bin/sh', '-c', command]
}

function serverUrl(config: ServerConfig): string {
  const url = config.url ?? (config.port ? `http://localhost:${config.port}` : undefined)
  if (!url) throw new Error('server.command requires server.url or server.port')
  return url
}

async function isHealthy(
  config: ServerConfig,
  url: string,
  deadline: number,
  serverRuntime: ServerRuntime,
): Promise<boolean> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), remaining)
  try {
    const response = await serverRuntime.fetch(
      config.readinessPath ? new URL(config.readinessPath, url) : url,
      { signal: controller.signal },
    )
    return config.readinessPath
      ? response.status >= 200 && response.status < 400
      : response.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export async function startServer(
  config: ServerConfig,
  serverRuntime: ServerRuntime = runtime,
): Promise<ManagedServer | undefined> {
  if (!config.command) return undefined
  const url = serverUrl(config)
  const timeoutMs = config.startupTimeoutMs ?? 30_000
  const deadline = Date.now() + timeoutMs

  if (config.reuseExisting && await isHealthy(config, url, deadline, serverRuntime)) {
    return { mode: 'reused', url, stop() {} }
  }

  const child: Subprocess = serverRuntime.spawn(commandForShell(config.command), {
    cwd: process.cwd(), stdout: 'ignore', stderr: 'pipe',
  })
  while (Date.now() < deadline) {
    if (await isHealthy(config, url, deadline, serverRuntime)) {
      return { mode: 'spawned', url, stop: () => child.kill() }
    }
    await serverRuntime.sleep(Math.min(config.pollIntervalMs ?? 500, deadline - Date.now()))
  }

  child.kill()
  throw new Error(
    `Server failed to start within ${timeoutMs}ms. Command: "${config.command}", URL: "${url}"`,
  )
}
