import type {
  ExecutionTimeouts,
  TargetSessionCompletion,
} from '../run-scenario-types'

class ExecutionDeadlineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionDeadlineError'
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return (
    Boolean(signal?.aborted) ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export function validateCompletion(
  completion: TargetSessionCompletion,
): TargetSessionCompletion {
  if (
    !Number.isSafeInteger(completion.inferenceCount) ||
    completion.inferenceCount < 0
  ) {
    throw new Error(
      'Target session completion requires a non-negative integer inferenceCount',
    )
  }
  return completion
}

export function executeWithDeadline<T>(
  operation: (signal?: AbortSignal) => Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
  timeoutMessage: string,
): Promise<T> {
  if (timeoutMs === undefined) return operation(signal)

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new ExecutionDeadlineError(timeoutMessage))
    }, timeoutMs)
    operation(controller.signal)
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      })
  })
}

export function stepDeadline(
  timeout: ExecutionTimeouts | undefined,
  scenarioStartedAt: number,
): { timeoutMs: number | undefined; timeoutMessage: string } {
  const scenarioRemaining =
    timeout?.scenarioMs === undefined
      ? undefined
      : timeout.scenarioMs - (Date.now() - scenarioStartedAt)
  const usesScenarioDeadline =
    scenarioRemaining !== undefined &&
    (timeout?.stepMs === undefined || scenarioRemaining <= timeout.stepMs)
  return {
    timeoutMs: usesScenarioDeadline
      ? Math.max(0, scenarioRemaining)
      : timeout?.stepMs,
    timeoutMessage: usesScenarioDeadline
      ? `Scenario exceeded its ${timeout?.scenarioMs}ms deadline`
      : `Step exceeded its ${timeout?.stepMs}ms deadline`,
  }
}
