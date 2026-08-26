import { z } from 'zod'

const variableName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/)

const templateSegmentSchema = z.union([
  z.strictObject({ literal: z.string() }),
  z.strictObject({ variable: variableName }),
])

const webTemplateSchema = z.strictObject({
  segments: z.array(templateSegmentSchema).min(1),
})

const webLocatorSchema = z.strictObject({
  selector: webTemplateSchema,
  nth: z.number().int().nonnegative().optional(),
})

const webCountLocatorSchema = z.strictObject({ selector: webTemplateSchema })

const webInstructionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('navigate'), url: webTemplateSchema }),
  z.strictObject({ kind: z.literal('click'), locator: webLocatorSchema }),
  z.strictObject({
    kind: z.literal('fill'),
    locator: webLocatorSchema,
    value: webTemplateSchema,
  }),
  z.strictObject({
    kind: z.literal('type'),
    locator: webLocatorSchema,
    value: webTemplateSchema,
  }),
  z.strictObject({ kind: z.literal('hover'), locator: webLocatorSchema }),
  z.strictObject({
    kind: z.literal('select-option'),
    locator: webLocatorSchema,
    values: z.array(webTemplateSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal('wait-for'),
    locator: webLocatorSchema,
    state: z.enum(['attached', 'detached', 'visible', 'hidden']),
  }),
  z.strictObject({ kind: z.literal('exists'), locator: webLocatorSchema }),
  z.strictObject({ kind: z.literal('visible'), locator: webLocatorSchema }),
  z.strictObject({ kind: z.literal('hidden'), locator: webLocatorSchema }),
  z.strictObject({
    kind: z.literal('text-equals'),
    locator: webLocatorSchema,
    expected: webTemplateSchema,
  }),
  z.strictObject({
    kind: z.literal('text-contains'),
    locator: webLocatorSchema,
    expected: webTemplateSchema,
  }),
  z.strictObject({
    kind: z.literal('value-equals'),
    locator: webLocatorSchema,
    expected: webTemplateSchema,
  }),
  z.strictObject({
    kind: z.literal('count-equals'),
    locator: webCountLocatorSchema,
    expected: z.union([
      z.number().int().nonnegative(),
      z.strictObject({ variable: variableName }),
    ]),
  }),
  z.strictObject({
    kind: z.literal('url-equals'),
    expected: webTemplateSchema,
  }),
])

export const webExecutionCachePayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  steps: z.array(
    z.strictObject({ instructions: z.array(webInstructionSchema).min(1) }),
  ),
})

export type WebTemplate = z.infer<typeof webTemplateSchema>
export type WebLocator = z.infer<typeof webLocatorSchema>
export type WebInstruction = z.infer<typeof webInstructionSchema>
export type WebExecutionCachePayload = z.infer<
  typeof webExecutionCachePayloadSchema
>
