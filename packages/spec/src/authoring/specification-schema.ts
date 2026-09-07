import { z } from 'zod'
import { specificationStates } from '../identity/identity-core'

const stepSchema = z.object({
  keyword: z.string(),
  text: z.string(),
  argument: z
    .object({
      dataTable: z.array(z.array(z.string())).optional(),
      docString: z.string().optional(),
    })
    .optional(),
})
const examplesSchema = z.object({
  name: z.string(),
  tags: z.array(z.string()),
  header: z.array(z.string()),
  rows: z.array(z.array(z.string())),
})
const backgroundSchema = z.object({
  kind: z.literal('background'),
  name: z.string(),
  steps: z.array(stepSchema),
})
const scenarioSchema = z.object({
  kind: z.literal('scenario'),
  keyword: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  steps: z.array(stepSchema),
  examples: z.array(examplesSchema),
})
const ruleSchema = z.object({
  kind: z.literal('rule'),
  name: z.string(),
  tags: z.array(z.string()),
  children: z.array(
    z.discriminatedUnion('kind', [backgroundSchema, scenarioSchema]),
  ),
})
export const structuredSpecificationSchema = z.object({
  name: z.string(),
  tags: z.array(z.string()),
  children: z.array(
    z.discriminatedUnion('kind', [
      backgroundSchema,
      scenarioSchema,
      ruleSchema,
    ]),
  ),
})
export const specificationStateSchema = z.enum(specificationStates)
export const externalLinkSchema = z.object({
  namespace: z.string(),
  id: z.string(),
})
export const specificationMetadataSchema = z.object({
  state: specificationStateSchema.optional(),
  tags: z.array(z.string()).optional(),
  links: z.array(externalLinkSchema).optional(),
})
export type StructuredStep = z.infer<typeof stepSchema>
export type StructuredExamples = z.infer<typeof examplesSchema>
export type StructuredBackground = z.infer<typeof backgroundSchema>
export type StructuredScenario = z.infer<typeof scenarioSchema>
export type StructuredRule = z.infer<typeof ruleSchema>
export type StructuredChild = z.infer<
  typeof structuredSpecificationSchema
>['children'][number]
export type StructuredSpecification = z.infer<
  typeof structuredSpecificationSchema
>
