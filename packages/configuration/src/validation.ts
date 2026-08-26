import { z } from 'zod'

export function parseConfiguration<T>(
  schema: z.ZodType<T>,
  value: unknown,
  fallbackMessage: string,
): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new Error(result.error.issues[0]?.message ?? fallbackMessage)
}

export function strictObject<Shape extends z.ZodRawShape>(
  field: string,
  shape: Shape,
) {
  return z.strictObject(shape, {
    error: (issue) => {
      if (issue.code === 'unrecognized_keys') {
        const keys = 'keys' in issue ? (issue.keys as string[]) : []
        return keys.map((key) => `${field}.${key} is not supported`).join('\n')
      }
      return `${field} must be an object`
    },
  })
}

export function optionalString(field: string) {
  return z.string({ error: `${field} must be a string` }).optional()
}

export function optionalBoolean(field: string) {
  return z.boolean({ error: `${field} must be a boolean` }).optional()
}

export function optionalPositiveInteger(field: string) {
  const message = `${field} must be an integer greater than or equal to 1`
  return z
    .number({ error: message })
    .int({ error: message })
    .min(1, { error: message })
    .optional()
}
