export function reasonMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function commaSeparatedValues(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
