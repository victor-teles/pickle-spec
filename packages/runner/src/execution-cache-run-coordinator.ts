import type {
  ExecutionCacheCoordination,
  ExecutionCacheKey,
  ExecutionCacheLease,
  ExecutionCacheLeaseWaitResult,
} from './execution-cache'

interface CoordinateExecutionCacheRunInput<Evaluation, Result> {
  coordination: ExecutionCacheCoordination
  cacheKey: ExecutionCacheKey
  signal?: AbortSignal
  observedRevision?: number
  replayPublished(): Promise<Result | undefined>
  reuseTerminal(
    outcome: NonNullable<
      Extract<
        ExecutionCacheLeaseWaitResult,
        { status: 'released' }
      >['terminalOutcome']
    >,
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

export async function coordinateExecutionCacheRun<Evaluation, Result>(
  input: CoordinateExecutionCacheRunInput<Evaluation, Result>,
): Promise<Result> {
  const { cacheKey, coordination } = input
  for (;;) {
    const acquisition = await coordination.acquire(cacheKey)
    if (!acquisition.acquired) {
      const waited = await coordination.wait(
        cacheKey,
        acquisition.ownerToken,
        acquisition.baselineRevision,
        input.signal,
      )
      if (waited.status !== 'released') return input.waitEnded(waited.status)
      if (waited.published) {
        const replay = await input.replayPublished()
        if (replay) return replay
      }
      if (waited.terminalOutcome) {
        const terminal = await input.reuseTerminal(waited.terminalOutcome)
        if (terminal) return terminal
      }
      continue
    }

    const heartbeat = startLeaseHeartbeat(coordination, acquisition.lease)
    try {
      const current = await coordination.readCurrent(cacheKey)
      if (current && current.revision !== input.observedRevision) {
        const replay = await input.replayPublished()
        if (replay) return replay
      }
      const evaluation = await input.evaluate()
      if (await heartbeat.stop()) return input.ownershipLost(evaluation)
      return await input.completeOwner(evaluation, acquisition.lease)
    } finally {
      await heartbeat.stop()
      await coordination.release(acquisition.lease)
    }
  }
}
