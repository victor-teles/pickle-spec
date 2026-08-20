import { z } from 'zod'

export const mobileWorkerProtocolVersion = 2 as const

export const androidCapabilities = [
  'android',
  'android-emulator',
  'screenshots',
  'device-logs',
  'recordings',
  'traces',
] as const

export const iosCapabilities = [
  'ios',
  'ios-simulator',
  'screenshots',
  'device-logs',
  'recordings',
  'traces',
] as const

const mobilePlatformSchema = z.enum(['android', 'ios'])

const mobileTargetSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  state: z.enum(['booted', 'offline']),
  capabilities: z.array(z.string()),
})

const mobileApplicationSchema = z.strictObject({
  id: z.string().min(1),
  binaryPath: z.string().min(1),
})

const mobileArtifactKindSchema = z.enum([
  'screenshot',
  'trace',
  'recording',
  'device-log',
])

const mobileTextRedactionSchema = z.strictObject({
  match: z.string().min(1),
  replacement: z.string().optional(),
})

const workerResolvedActionSchema = z.strictObject({
  description: z.string(),
  replay: z.record(z.string(), z.unknown()).optional(),
})

const mobileStepSchema = z.strictObject({
  type: z.enum(['context', 'action', 'outcome']),
  text: z.string(),
})

const workerStepExecutionSchema = z.strictObject({
  state: z.enum([
    'passed',
    'passed-with-adaptation',
    'failed',
    'cancelled',
    'infrastructure-error',
  ]),
  resolvedActions: z.array(workerResolvedActionSchema),
  message: z.string().optional(),
  artifacts: z
    .array(
      z.strictObject({
        kind: mobileArtifactKindSchema,
        path: z.string(),
        mediaType: z.string().optional(),
      }),
    )
    .optional(),
})

const executionPlanSchema = z.strictObject({
  steps: z.array(
    z.strictObject({
      resolvedActions: z.array(workerResolvedActionSchema),
    }),
  ),
})

export const mobileWorkerRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('discover-targets'),
    platform: mobilePlatformSchema.optional(),
  }),
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('open-session'),
    sessionId: z.string().min(1),
    platform: mobilePlatformSchema.optional(),
    targetId: z.string().min(1).optional(),
    application: mobileApplicationSchema,
    mode: z.enum(['adaptive', 'replay']),
    artifactDirectory: z.string().min(1).optional(),
    artifacts: z.array(mobileArtifactKindSchema).optional(),
    redactions: z.array(mobileTextRedactionSchema).optional(),
    requiredCapabilities: z.array(z.string().min(1)).optional(),
    plan: executionPlanSchema.optional(),
  }),
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('execute-step'),
    sessionId: z.string().min(1),
    stepIndex: z.number().int().nonnegative(),
    step: mobileStepSchema,
  }),
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('close-session'),
    sessionId: z.string().min(1),
  }),
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('cancel-session'),
    sessionId: z.string().min(1),
  }),
])

export const mobileWorkerResponseSchema = z.discriminatedUnion('type', [
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('targets-discovered'),
    targets: z.array(mobileTargetSchema),
  }),
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('session-opened'),
    sessionId: z.string().min(1),
    targetId: z.string().min(1),
  }),
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('session-closed'),
    sessionId: z.string().min(1),
  }),
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('step-executed'),
    sessionId: z.string().min(1),
    execution: workerStepExecutionSchema,
  }),
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('session-cancelled'),
    sessionId: z.string().min(1),
  }),
])

export const workerReadyMessageSchema = z.strictObject({
  version: z.literal(mobileWorkerProtocolVersion),
  type: z.literal('worker-ready'),
  nodeVersion: z.string(),
})

export const workerResponseMessageSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('response'),
    id: z.number().int().positive(),
    ok: z.literal(true),
    payload: mobileWorkerResponseSchema,
  }),
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('response'),
    id: z.number().int().positive(),
    ok: z.literal(false),
    error: z.string().min(1),
  }),
])

export const workerRequestMessageSchema = z.strictObject({
  version: z.literal(mobileWorkerProtocolVersion),
  type: z.literal('request'),
  id: z.number().int().positive(),
  payload: mobileWorkerRequestSchema,
})

export type MobilePlatform = z.infer<typeof mobilePlatformSchema>
export type MobileApplication = z.infer<typeof mobileApplicationSchema>
export type MobileTarget = z.infer<typeof mobileTargetSchema>
export type MobileArtifactKind = z.infer<typeof mobileArtifactKindSchema>
export type MobileTextRedaction = z.infer<typeof mobileTextRedactionSchema>
export type AndroidTarget = MobileTarget
export type AndroidApplication = MobileApplication
export type IosTarget = MobileTarget
export type IosApplication = MobileApplication
export type MobileStep = z.infer<typeof mobileStepSchema>
export type WorkerResolvedAction = z.infer<typeof workerResolvedActionSchema>
export type WorkerStepExecution = z.infer<typeof workerStepExecutionSchema>
export type MobileWorkerRequest = z.infer<typeof mobileWorkerRequestSchema>
export type MobileWorkerResponse = z.infer<typeof mobileWorkerResponseSchema>
