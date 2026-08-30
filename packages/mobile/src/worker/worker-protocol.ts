import { z } from 'zod'
import { mobileExecutionCachePayloadSchema } from '../execution-cache/mobile-execution-cache.ts'

export const mobileWorkerProtocolVersion = 5 as const

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

const mobileApplicationSchema = z.union([
  z.strictObject({
    id: z.string().min(1),
    binaryPath: z.string().min(1),
  }),
  z.strictObject({
    id: z.string().min(1),
    installed: z.literal(true),
  }),
])

const mobileArtifactKindSchema = z.enum([
  'screenshot',
  'trace',
  'recording',
  'device-log',
])

const evidenceAvailabilityStateSchema = z.enum([
  'available',
  'not-requested',
  'not-supported',
  'not-retained',
  'capture-failed',
  'missing',
])

const mobileTextRedactionSchema = z.strictObject({
  match: z.string().min(1),
  replacement: z.string().optional(),
})

const workerResolvedActionSchema = z.strictObject({
  description: z.string(),
})

const mobileStepSchema = z.strictObject({
  type: z.enum(['context', 'action', 'outcome']),
  text: z.string(),
  argument: z
    .strictObject({
      dataTable: z.array(z.array(z.string())).optional(),
      docString: z.string().optional(),
    })
    .optional(),
})

const mobileRuntimeBindingSchema = z.strictObject({
  name: z.string().min(1),
  value: z.string(),
})

const mobileScenarioSchema = z
  .strictObject({
    steps: z.array(mobileStepSchema).min(1),
    templateSteps: z.array(mobileStepSchema).min(1),
    runtimeBindings: z.array(mobileRuntimeBindingSchema),
  })
  .superRefine((scenario, context) => {
    if (scenario.steps.length !== scenario.templateSteps.length) {
      context.addIssue({
        code: 'custom',
        message: 'Runtime and template Scenario steps must have equal length',
      })
    }
    const names = scenario.runtimeBindings.map((binding) => binding.name)
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: 'custom',
        message: 'Runtime binding names must be unique',
      })
    }
  })

const workerStepExecutionSchema = z.strictObject({
  state: z.enum(['passed', 'failed', 'cancelled', 'infrastructure-error']),
  resolvedActions: z.array(workerResolvedActionSchema),
  replayDiverged: z.boolean().optional(),
  message: z.string().optional(),
  artifacts: z
    .array(
      z.strictObject({
        kind: mobileArtifactKindSchema,
        path: z.string(),
        mediaType: z.string().optional(),
        name: z.string().min(1).optional(),
        capturedAt: z.iso.datetime({ offset: true }).optional(),
        sizeBytes: z.number().int().nonnegative().safe().optional(),
      }),
    )
    .optional(),
  evidenceAvailability: z
    .array(
      z.strictObject({
        kind: mobileArtifactKindSchema,
        state: evidenceAvailabilityStateSchema,
        message: z.string().optional(),
      }),
    )
    .optional(),
})

const workerScenarioExecutionSchema = z.strictObject({
  stepExecutions: z.array(workerStepExecutionSchema),
  replayDiverged: z.boolean().optional(),
})

const workerReplayRepresentationSchema = z.discriminatedUnion('cacheable', [
  z.strictObject({
    cacheable: z.literal(true),
    adapterPayload: mobileExecutionCachePayloadSchema,
    requiredVariables: z.array(z.string().min(1)),
  }),
  z.strictObject({
    cacheable: z.literal(false),
    reason: z.enum([
      'application-revision-missing',
      'bound-parameter-value',
      'non-deterministic-action',
      'non-deterministic-assertion',
      'payload-validation-failed',
      'entry-too-large',
    ]),
  }),
])

const workerSessionCompletionSchema = z.strictObject({
  inferenceCount: z.number().int().nonnegative(),
  evaluationModel: z.string().min(1).optional(),
  replayRepresentation: workerReplayRepresentationSchema.optional(),
})

const workerReplayCacheSchema = z.strictObject({
  adapterPayload: mobileExecutionCachePayloadSchema,
  requiredVariables: z.array(z.string().min(1)),
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
    scenario: mobileScenarioSchema,
    executionCache: workerReplayCacheSchema.optional(),
  }),
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('execute-scenario'),
    sessionId: z.string().min(1),
  }),
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('complete-session'),
    sessionId: z.string().min(1),
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
    type: z.literal('scenario-executed'),
    sessionId: z.string().min(1),
    execution: workerScenarioExecutionSchema,
  }),
  z.strictObject({
    version: z.literal(mobileWorkerProtocolVersion),
    type: z.literal('session-completed'),
    sessionId: z.string().min(1),
    completion: workerSessionCompletionSchema,
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

const mobileWorkerViewportFrameSchema = z.strictObject({
  data: z.string().min(1),
  mimeType: z.literal('image/png'),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export const mobileWorkerEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('viewport-frame'),
    sessionId: z.string().min(1),
    frame: mobileWorkerViewportFrameSchema,
  }),
  z.strictObject({
    type: z.literal('viewport-closed'),
    sessionId: z.string().min(1),
  }),
])

export const workerEventMessageSchema = z.strictObject({
  version: z.literal(mobileWorkerProtocolVersion),
  type: z.literal('event'),
  payload: mobileWorkerEventSchema,
})

export const workerOutputMessageSchema = z.discriminatedUnion('type', [
  workerResponseMessageSchema,
  workerEventMessageSchema,
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
export type MobileWorkerScenario = z.infer<typeof mobileScenarioSchema>
export type WorkerResolvedAction = z.infer<typeof workerResolvedActionSchema>
export type WorkerStepExecution = z.infer<typeof workerStepExecutionSchema>
export type WorkerScenarioExecution = z.infer<
  typeof workerScenarioExecutionSchema
>
export type WorkerSessionCompletion = z.infer<
  typeof workerSessionCompletionSchema
>
export type MobileWorkerRequest = z.infer<typeof mobileWorkerRequestSchema>
export type MobileWorkerResponse = z.infer<typeof mobileWorkerResponseSchema>
export type MobileWorkerEvent = z.infer<typeof mobileWorkerEventSchema>
export type WorkerOutputMessage = z.infer<typeof workerOutputMessageSchema>
