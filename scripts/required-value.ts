export function requiredValue<T>(
  value: T | null | undefined,
  message = 'Required value is missing',
): T {
  if (value === undefined || value === null) throw new Error(message)
  return value
}
