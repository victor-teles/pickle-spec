export function reasonMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function commaSeparatedValues(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
