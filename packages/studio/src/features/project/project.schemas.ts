import {
  externalLinkSchema,
  specificationStateSchema,
} from '@pickle-spec/spec/schemas'
import { z } from 'zod'
import type {
  StudioConfigPatch,
  StudioMobileTargetDiscovery,
  StudioProject,
  StudioRunReadiness,
} from './project.contracts'

const readinessCheckIdSchema = z.enum([
  'selection',
  'execution-target',
  'model-credential',
  'environment',
])
export const studioRunReadinessSchema: z.ZodType<StudioRunReadiness> = z.object(
  {
    ready: z.boolean(),
    reasons: z.array(z.string()),
    checks: z
      .array(
        z.discriminatedUnion('status', [
          z.object({ id: readinessCheckIdSchema, status: z.literal('ready') }),
          z.object({
            id: readinessCheckIdSchema,
            status: z.literal('not-applicable'),
          }),
          z.object({
            id: readinessCheckIdSchema,
            status: z.literal('blocked'),
            reasons: z.tuple([z.string()], z.string()),
          }),
        ]),
      )
      .optional(),
  },
)
const mobileExecutionTargetSchema = z.enum([
  'android-emulator',
  'ios-simulator',
])
const mobileProfileSchema = z.object({
  executionTarget: mobileExecutionTargetSchema,
  application: z.object({ id: z.string(), binaryPath: z.string().optional() }),
  targetId: z.string().optional(),
  artifactDirectory: z.string().optional(),
  artifacts: z
    .array(z.enum(['screenshot', 'trace', 'recording', 'device-log']))
    .optional(),
  redactions: z
    .array(z.object({ match: z.string(), replacement: z.string().optional() }))
    .optional(),
  nodePath: z.string().optional(),
})
const suiteConfigurationSchema = z.object({
  paths: z.union([z.string(), z.array(z.string())]).optional(),
  tagExpression: z.string().optional(),
  states: z.array(specificationStateSchema).optional(),
  scenarioName: z.string().optional(),
})
const profileConfigurationSchema = z.object({
  adapter: z.string(),
  capabilities: z.array(z.string()).optional(),
  mobile: mobileProfileSchema.optional(),
})
export const studioConfigPatchSchema: z.ZodType<StudioConfigPatch> = z.object({
  suites: z.record(z.string(), suiteConfigurationSchema).optional(),
  executionTargetProfiles: z
    .record(z.string(), profileConfigurationSchema)
    .optional(),
  links: z.record(z.string(), z.string()).optional(),
  secrets: z.record(z.string(), z.object({ keychain: z.string() })).optional(),
})
export const credentialWriteRequestSchema = z.object({
  name: z.string().optional(),
  secret: z.string().optional(),
})
export const studioProjectSchema: z.ZodType<StudioProject> = z.object({
  name: z.string(),
  root: z.string(),
  profiles: z.array(z.string()),
  suites: z.array(z.string()),
  specifications: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      uri: z.string(),
      state: specificationStateSchema.optional(),
      tags: z.array(z.string()).optional(),
      links: z.array(externalLinkSchema).optional(),
      canRun: z.boolean().optional(),
      runReasons: z.array(z.string()).optional(),
      scenarios: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          canRun: z.boolean().optional(),
          readiness: studioRunReadinessSchema.optional(),
        }),
      ),
    }),
  ),
  model: z.object({ provider: z.string(), name: z.string() }).optional(),
  links: z.record(z.string(), z.string()).optional(),
  suiteDetails: z
    .array(suiteConfigurationSchema.extend({ name: z.string() }))
    .optional(),
  profileDetails: z
    .array(profileConfigurationSchema.extend({ id: z.string() }))
    .optional(),
  secrets: z
    .array(z.object({ name: z.string(), present: z.boolean() }))
    .optional(),
  readiness: studioRunReadinessSchema.optional(),
})
export const mobileTargetDiscoveriesSchema: z.ZodType<
  readonly StudioMobileTargetDiscovery[]
> = z.array(
  z.object({
    profileId: z.string(),
    executionTarget: mobileExecutionTargetSchema,
    targets: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        state: z.enum(['booted', 'offline']),
        capabilities: z.array(z.string()),
      }),
    ),
    error: z.string().optional(),
  }),
)
