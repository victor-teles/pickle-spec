export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function withRecoveryFailure(
  primaryError: unknown,
  recovery: string,
  recoveryError: unknown,
): AggregateError {
  return new AggregateError(
    [primaryError, recoveryError],
    `${errorMessage(primaryError)}\n${recovery}: ${errorMessage(recoveryError)}`,
  )
}
