export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function withRecoveryFailure(
  primaryError: Error,
  recovery: string,
  cause: unknown,
): AggregateError {
  return new AggregateError(
    [primaryError, cause],
    `${errorMessage(primaryError)}\n${recovery}: ${errorMessage(cause)}`,
  )
}

export function commandErrorFrom(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause), { cause })
}
