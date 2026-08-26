import type {
  ExecutionCacheCoordination,
  ExecutionCacheKey,
  ExecutionCacheLease,
  ExecutionCacheLeaseWaitResult,
  SerializedExecutionCacheTerminalOutcome,
} from './execution-cache'

interface CoordinateExecutionCacheRunInput<Evaluation, Result> {
  coordination: ExecutionCacheCoordination
  cacheKey: ExecutionCacheKey
  signal?: AbortSignal
  observedRevision?: number
  replayPublished(): Promise<Result | undefined>
  reuseTerminal(
    outcome: SerializedExecutionCacheTerminalOutcome,
  ): Promise<Result | undefined>
  waitEnded(
    status: Extract<
      ExecutionCacheLeaseWaitResult,
      { status: 'timed-out' | 'cancelled' }
    >['status'],
  ): Promise<Result>
  evaluate(): Promise<Evaluation>
  ownershipLost(evaluation: Evaluation): Promise<Result>
  completeOwner(
    evaluation: Evaluation,
    lease: ExecutionCacheLease,
  ): Promise<Result>
}

interface LeaseHeartbeat {
  stop(): Promise<boolean>
}

type CoordinatedWaitResult<Result> =
  | { status: 'resolved'; result: Result }
  | { status: 'retry' }

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function startLeaseHeartbeat(
  coordination: ExecutionCacheCoordination,
  lease: ExecutionCacheLease,
): LeaseHeartbeat {
  const controller = new AbortController()
  let ownershipLost = false
  const heartbeat = (async () => {
    while (!controller.signal.aborted) {
      await waitForDelay(lease.heartbeatMs, controller.signal)
      if (controller.signal.aborted) return
      if (!(await coordination.renew(lease))) {
        ownershipLost = true
        return
      }
    }
  })()
  return {
    async stop() {
      controller.abort()
      await heartbeat
      return ownershipLost
    },
  }
}

async function waitForCoordinatedResult<Evaluation, Result>(
  input: CoordinateExecutionCacheRunInput<Evaluation, Result>,
  ownerToken: string,
  baselineRevision: number | undefined,
): Promise<CoordinatedWaitResult<Result>> {
  const waited = await input.coordination.wait(
    input.cacheKey,
    ownerToken,
    baselineRevision,
    input.signal,
  )
  if (waited.status !== 'released') {
    return { status: 'resolved', result: await input.waitEnded(waited.status) }
  }
  if (waited.published) {
    const replay = await input.replayPublished()
    if (replay) return { status: 'resolved', result: replay }
  }
  if (waited.terminalOutcome) {
    const terminal = await input.reuseTerminal(waited.terminalOutcome)
    if (terminal) return { status: 'resolved', result: terminal }
  }
  return { status: 'retry' }
}

async function evaluateWithLease<Evaluation, Result>(
  input: CoordinateExecutionCacheRunInput<Evaluation, Result>,
  lease: ExecutionCacheLease,
): Promise<Result> {
  const heartbeat = startLeaseHeartbeat(input.coordination, lease)
  try {
    const current = await input.coordination.readCurrent(input.cacheKey)
    if (current && current.revision !== input.observedRevision) {
      const replay = await input.replayPublished()
      if (replay) return replay
    }
    const evaluation = await input.evaluate()
    if (await heartbeat.stop()) return input.ownershipLost(evaluation)
    return await input.completeOwner(evaluation, lease)
  } finally {
    await heartbeat.stop()
    await input.coordination.release(lease)
  }
}

export async function coordinateExecutionCacheRun<Evaluation, Result>(
  input: CoordinateExecutionCacheRunInput<Evaluation, Result>,
): Promise<Result> {
  const { cacheKey, coordination } = input
  for (;;) {
    const acquisition = await coordination.acquire(cacheKey)
    if (!acquisition.acquired) {
      const waited = await waitForCoordinatedResult(
        input,
        acquisition.ownerToken,
        acquisition.baselineRevision,
      )
      if (waited.status === 'resolved') return waited.result
      continue
    }
    return evaluateWithLease(input, acquisition.lease)
  }
}
