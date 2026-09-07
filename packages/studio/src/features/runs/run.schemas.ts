import {
  diagnosticEntrySchema,
  runEventScopeSchema,
  specificationIdentitySchema,
  scenarioIdentitySchema,
  executionTargetProfileSchema,
  runEventSchema,
  testRunManifestSchema,
} from '@pickle-spec/runner/schemas'
import { z } from 'zod'
import type {
  StudioRunRequest,
  StudioRunSnapshot,
  StudioRunStreamEvent,
} from './run.contracts'

export const studioRunRequestSchema: z.ZodType<StudioRunRequest> = z.object({
  suite: z.string().optional(),
  profiles: z.array(z.string()).optional(),
  paths: z.array(z.string()).optional(),
  scenarioName: z.string().optional(),
  scenarioId: z.string().optional(),
  rerunId: z.string().optional(),
  failures: z.boolean().optional(),
  refreshCache: z.boolean().optional(),
})
const scheduledResultSchema = z.object({
  specification: specificationIdentitySchema,
  scenario: scenarioIdentitySchema,
  executionTargetProfile: executionTargetProfileSchema,
})
export const studioRunSnapshotSchema: z.ZodType<StudioRunSnapshot> = z.object({
  id: z.string(),
  events: z.array(runEventSchema),
  manifest: testRunManifestSchema.optional(),
  schedule: z.array(scheduledResultSchema).optional(),
})
const viewportTargetSchema = z.object({
  scenarioId: z.string(),
  examplesRowId: z.string().optional(),
  profileId: z.string(),
  attempt: z.number().optional(),
})
const frameFields = {
  data: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
}
const viewportSchema = z.discriminatedUnion('kind', [
  z.object({
    ...frameFields,
    kind: z.literal('frame'),
    mimeType: z.literal('image/jpeg'),
  }),
  z.object({
    ...frameFields,
    kind: z.literal('device-frame'),
    mimeType: z.literal('image/png'),
  }),
  z.object({
    kind: z.literal('browserbase'),
    sessionId: z.string(),
    url: z.string(),
  }),
])
export const studioRunStreamEventSchema: z.ZodType<StudioRunStreamEvent> =
  z.union([
    runEventSchema,
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('viewport-updated'),
        target: viewportTargetSchema,
        viewport: viewportSchema,
      }),
      z.object({
        type: z.literal('viewport-closed'),
        target: viewportTargetSchema,
      }),
      z.object({
        type: z.literal('diagnostic-recorded'),
        profileId: z.string(),
        scope: runEventScopeSchema.optional(),
        diagnostic: diagnosticEntrySchema,
      }),
      z.object({
        type: z.literal('run-scheduled'),
        schedule: z.array(scheduledResultSchema),
      }),
      z.object({
        type: z.literal('run-finished'),
        run: z.object({ id: z.string() }),
      }),
    ]),
  ])
export const startedRunSchema = z.object({ id: z.string() })
