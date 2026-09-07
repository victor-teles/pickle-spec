import {
  structuredSpecificationSchema,
  specificationMetadataSchema,
} from '@pickle-spec/spec/schemas'
import { z } from 'zod'

export const documentPreviewRequestSchema = z.object({
  uri: z.string(),
  source: z.string(),
  specification: structuredSpecificationSchema.optional(),
  metadata: specificationMetadataSchema.optional(),
  diffAgainst: z.string().optional(),
})
export const documentWriteRequestSchema = z.object({
  uri: z.string(),
  source: z.string(),
  expectedRevision: z.string().optional(),
  create: z.boolean().optional(),
})
export const documentProposeRequestSchema = z.object({
  prompt: z.string(),
  uri: z.string().optional(),
  currentSource: z.string().optional(),
})
export const specificationBufferSchema = z.object({
  uri: z.string(),
  source: z.string(),
  revision: z.string(),
  specification: structuredSpecificationSchema,
})
export const specificationPreviewSchema = specificationBufferSchema.extend({
  diff: z.string(),
})
export const gherkinCatalogSchema = z.object({
  tags: z.array(z.string()),
  steps: z.array(z.string()),
})
export const documentConflictSchema = z.object({
  code: z.literal('conflict'),
  diskSource: z.string(),
  revision: z.string(),
  diff: z.string(),
})
export const diskChangedEventSchema = z.object({
  type: z.literal('disk-changed'),
  uri: z.string(),
  source: z.string(),
  revision: z.string(),
})
export type SpecificationBuffer = z.infer<typeof specificationBufferSchema>
export type SpecificationPreview = z.infer<typeof specificationPreviewSchema>
