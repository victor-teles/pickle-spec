import type { Subprocess } from 'bun'
import type { ServerConfig } from '../configuration/config'

export interface ManagedServer {
  mode: 'spawned' | 'reused'
  url: string
  outputAvailability: ApplicationOutputAvailability
  outputComplete: Promise<void>
  stop(): void
}

export type ApplicationOutputStream = 'stdout' | 'stderr'

export interface ApplicationOutputLine {
  occurredAt: string
  stream: ApplicationOutputStream
  line: string
}

export type ApplicationOutputAvailabilityState =
  | 'available'
  | 'not-requested'
  | 'not-supported'

export type ApplicationOutputAvailability = Record<
  ApplicationOutputStream,
  ApplicationOutputAvailabilityState
>

type ManagedApplicationProcess = Pick<
  Subprocess,
  'pid' | 'stdout' | 'stderr' | 'kill'
>

interface ServerSpawnOptions {
  cwd: string
  detached: boolean
  stdout: 'ignore' | 'pipe'
  stderr: 'ignore' | 'pipe'
}

export interface ServerRuntime {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
  sleep(durationMs: number): Promise<void>
  spawn(
    command: string[],
    options: ServerSpawnOptions,
  ): ManagedApplicationProcess
}

export interface StartServerOptions {
  runtime?: ServerRuntime
  signal?: AbortSignal
  now?: () => Date
  onOutput?: (line: ApplicationOutputLine) => void | Promise<void>
}

const runtime: ServerRuntime = {
  fetch,
  sleep: Bun.sleep,
  spawn: (command, options) => Bun.spawn(command, options),
}

function outputAvailability(
  config: ServerConfig,
  supported: boolean,
): ApplicationOutputAvailability {
  const state = (stream: ApplicationOutputStream) => {
    if (!config.output?.[stream]) return 'not-requested' as const
    return supported ? ('available' as const) : ('not-supported' as const)
  }
  return { stdout: state('stdout'), stderr: state('stderr') }
}

async function observeOutput(
  source: ReadableStream<Uint8Array>,
  stream: ApplicationOutputStream,
  now: () => Date,
  onOutput?: StartServerOptions['onOutput'],
): Promise<void> {
  const decoder = new TextDecoder()
  const reader = source.getReader()
  let pending = ''
  const emit = async (line: string) => {
    await onOutput?.({ occurredAt: now().toISOString(), stream, line })
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) await emit(line.replace(/\r$/, ''))
    }
    pending += decoder.decode()
    if (pending.length > 0) await emit(pending.replace(/\r$/, ''))
  } finally {
    reader.releaseLock()
  }
}

function stopServerProcess(child: ManagedApplicationProcess): void {
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
  const now = options.now ?? (() => new Date())
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
    return {
      mode: 'reused',
      url,
      outputAvailability: outputAvailability(config, false),
      outputComplete: Promise.resolve(),
      stop() {},
    }
  }

  throwIfCancelled(signal)
  const child = serverRuntime.spawn(commandForShell(config.command), {
    cwd: process.cwd(),
    detached: process.platform !== 'win32',
    stdout: config.output?.stdout ? 'pipe' : 'ignore',
    stderr: config.output?.stderr ? 'pipe' : 'ignore',
  })
  const outputTasks: Promise<void>[] = []
  if (config.output?.stdout && child.stdout instanceof ReadableStream) {
    outputTasks.push(
      observeOutput(child.stdout, 'stdout', now, options.onOutput),
    )
  }
  if (config.output?.stderr && child.stderr instanceof ReadableStream) {
    outputTasks.push(
      observeOutput(child.stderr, 'stderr', now, options.onOutput),
    )
  }
  const outputComplete = Promise.all(outputTasks).then(() => undefined)
  try {
    while (Date.now() < deadline) {
      throwIfCancelled(signal)
      if (await isHealthy(config, url, deadline, serverRuntime, signal)) {
        throwIfCancelled(signal)
        return {
          mode: 'spawned',
          url,
          outputAvailability: outputAvailability(config, true),
          outputComplete,
          stop: () => stopServerProcess(child),
        }
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
