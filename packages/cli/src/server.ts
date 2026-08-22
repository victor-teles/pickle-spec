import type { Subprocess } from 'bun'
import type { ServerConfig } from './config'

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

export interface StartServerOptions {
  runtime?: ServerRuntime
  signal?: AbortSignal
}

const runtime: ServerRuntime = { fetch, sleep: Bun.sleep, spawn: Bun.spawn }

function stopServerProcess(child: Subprocess): void {
  if (process.platform === 'win32') {
    child.kill()
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

function commandForShell(command: string): string[] {
  return process.platform === 'win32'
    ? ['cmd.exe', '/d', '/s', '/c', command]
    : ['/bin/sh', '-c', command]
}

function serverUrl(config: ServerConfig): string {
  const url =
    config.url ?? (config.port ? `http://localhost:${config.port}` : undefined)
  if (!url) throw new Error('server.command requires server.url or server.port')
  return url
}

async function isHealthy(
  config: ServerConfig,
  url: string,
  deadline: number,
  serverRuntime: ServerRuntime,
  signal?: AbortSignal,
): Promise<boolean> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return false
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  const timeout = setTimeout(() => controller.abort(), remaining)
  signal?.addEventListener('abort', onAbort, { once: true })
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
    signal?.removeEventListener('abort', onAbort)
  }
}

function cancellationError(): DOMException {
  return new DOMException('Server startup cancelled', 'AbortError')
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellationError()
}

async function waitForPoll(
  durationMs: number,
  serverRuntime: ServerRuntime,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await serverRuntime.sleep(durationMs)
    return
  }
  throwIfCancelled(signal)
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      reject(cancellationError())
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, durationMs)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

export async function startServer(
  config: ServerConfig,
  options: StartServerOptions = {},
): Promise<ManagedServer | undefined> {
  const serverRuntime = options.runtime ?? runtime
  const signal = options.signal
  if (!config.command) return undefined
  throwIfCancelled(signal)
  const url = serverUrl(config)
  const timeoutMs = config.startupTimeoutMs ?? 30_000
  const deadline = Date.now() + timeoutMs

  if (
    config.reuseExisting &&
    (await isHealthy(config, url, deadline, serverRuntime, signal))
  ) {
    throwIfCancelled(signal)
    return { mode: 'reused', url, stop() {} }
  }

  throwIfCancelled(signal)
  const child: Subprocess = serverRuntime.spawn(
    commandForShell(config.command),
    {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      stdout: 'ignore',
      stderr: 'ignore',
    },
  )
  try {
    while (Date.now() < deadline) {
      throwIfCancelled(signal)
      if (await isHealthy(config, url, deadline, serverRuntime, signal)) {
        throwIfCancelled(signal)
        return { mode: 'spawned', url, stop: () => stopServerProcess(child) }
      }
      throwIfCancelled(signal)
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      await waitForPoll(
        Math.min(config.pollIntervalMs ?? 500, remaining),
        serverRuntime,
        signal,
      )
    }
    throw new Error(
      `Server failed to start within ${timeoutMs}ms. Command: "${config.command}", URL: "${url}"`,
    )
  } catch (error) {
    stopServerProcess(child)
    throw error
  }
}
