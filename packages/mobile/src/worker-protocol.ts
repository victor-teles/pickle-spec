import { z } from 'zod'

export const mobileWorkerProtocolVersion = 1 as const

export const androidCapabilities = [
  'android',
  'android-emulator',
  'screenshots',
] as const

const androidTargetSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  state: z.enum(['booted', 'offline']),
  capabilities: z.array(z.string()),
})

const androidApplicationSchema = z.strictObject({
  id: z.string().min(1),
  binaryPath: z.string().min(1),
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
        kind: z.enum(['screenshot', 'device-log']),
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
  }),
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('open-session'),
    sessionId: z.string().min(1),
    targetId: z.string().min(1).optional(),
    application: androidApplicationSchema,
    mode: z.enum(['adaptive', 'replay']),
    artifactDirectory: z.string().min(1).optional(),
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
    targets: z.array(androidTargetSchema),
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

export type AndroidTarget = z.infer<typeof androidTargetSchema>
export type AndroidApplication = z.infer<typeof androidApplicationSchema>
export type MobileStep = z.infer<typeof mobileStepSchema>
export type WorkerResolvedAction = z.infer<typeof workerResolvedActionSchema>
export type WorkerStepExecution = z.infer<typeof workerStepExecutionSchema>
export type MobileWorkerRequest = z.infer<typeof mobileWorkerRequestSchema>
export type MobileWorkerResponse = z.infer<typeof mobileWorkerResponseSchema>
