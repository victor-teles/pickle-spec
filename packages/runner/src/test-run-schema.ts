import { z } from 'zod'
import { persistedEvidenceKinds } from './evidence'
import type {
  RunEvent,
  ScenarioAttempt,
  TestResult,
  TestStepResult,
} from './run-scenario'
import {
  diagnosticLevels,
  diagnosticOrigins,
  evidenceKinds,
  testRunSchemaVersion,
  traceActivityKinds,
} from './run-scenario'
import type { TestRunManifest } from './test-run-store'

type IncompatibleSchema = (version: unknown) => never

const resultStateSchema = z.enum(
  ['passed', 'failed', 'skipped', 'cancelled', 'infrastructure-error'],
  { error: 'Test result state must be a current result state' },
)
const nonNegativeIntegerSchema = z.number().int().nonnegative().safe()
const positiveIntegerSchema = z.number().int().positive().safe()
const timestampSchema = z.iso.datetime({ offset: true })

interface TimedEvidence {
  startedAt: string
  finishedAt: string
  durationMs: number
}

function validateTiming(value: TimedEvidence, context: z.RefinementCtx): void {
  const elapsedMs = Date.parse(value.finishedAt) - Date.parse(value.startedAt)
  if (elapsedMs < 0) {
    context.addIssue({
      code: 'custom',
      path: ['finishedAt'],
      message: 'finishedAt must not precede startedAt',
    })
  }
  if (value.durationMs !== Math.max(0, elapsedMs)) {
    context.addIssue({
      code: 'custom',
      path: ['durationMs'],
      message: 'durationMs must match startedAt and finishedAt',
    })
  }
}

const scenarioStepSchema = z.object({
  keyword: z.string(),
  text: z.string(),
  type: z.enum(['context', 'action', 'outcome']),
  argument: z
    .object({
      dataTable: z.array(z.array(z.string())).optional(),
      docString: z.string().optional(),
    })
    .optional(),
})

const resolvedActionSchema = z.object({
  description: z.string(),
  replay: z.record(z.string(), z.unknown()).optional(),
})

const artifactSchema = z.object({
  kind: z.enum(['screenshot', 'trace', 'recording', 'device-log']),
  path: z.string(),
  mediaType: z.string().optional(),
  name: z.string().min(1).optional(),
  capturedAt: timestampSchema.optional(),
  sizeBytes: nonNegativeIntegerSchema.optional(),
})

const diagnosticEntrySchema = z.object({
  occurredAt: timestampSchema,
  causalAt: timestampSchema.optional(),
  level: z.enum(diagnosticLevels),
  origin: z.enum(diagnosticOrigins),
  stream: z.enum(['stdout', 'stderr']).optional(),
  message: z.string(),
  scenarioId: z.string().optional(),
  scenarioName: z.string().optional(),
  stepIndex: nonNegativeIntegerSchema.optional(),
  stepText: z.string().optional(),
  executionTargetProfileId: z.string().optional(),
})

const traceEntrySchema = z.object({
  occurredAt: timestampSchema,
  causalAt: timestampSchema.optional(),
  kind: z.enum(traceActivityKinds),
  description: z.string(),
})

const testStepResultSchema: z.ZodType<TestStepResult> = z
  .object({
    index: nonNegativeIntegerSchema,
    startedAt: timestampSchema,
    finishedAt: timestampSchema,
    durationMs: nonNegativeIntegerSchema,
    step: scenarioStepSchema,
    state: resultStateSchema,
    resolvedActions: z.array(resolvedActionSchema),
    message: z.string().optional(),
    artifacts: z.array(artifactSchema).optional(),
    diagnostics: z.array(diagnosticEntrySchema).optional(),
    trace: z.array(traceEntrySchema).optional(),
  })
  .superRefine(validateTiming)

const fidelityPolicySchema = z.object({
  profile: z.enum(['default', 'fast']),
  tradeOffs: z.array(z.string()),
})

const evidenceAvailabilitySchema = z.object({
  kind: z.enum(evidenceKinds),
  state: z.enum([
    'available',
    'not-requested',
    'not-supported',
    'not-retained',
    'capture-failed',
    'missing',
  ]),
  message: z.string().optional(),
})

const applicationOutputEvidenceAvailabilitySchema = z.object({
  stream: z.enum(['stdout', 'stderr']),
  state: z.enum([
    'available',
    'not-requested',
    'not-supported',
    'not-retained',
    'capture-failed',
    'missing',
  ]),
  message: z.string().optional(),
})

function validateEvidenceAvailability(
  attempt: ScenarioAttempt,
  context: z.RefinementCtx,
): void {
  const availabilityByKind = new Map<
    ScenarioAttempt['evidenceAvailability'][number]['kind'],
    ScenarioAttempt['evidenceAvailability'][number]
  >()
  for (const [index, availability] of attempt.evidenceAvailability.entries()) {
    if (availabilityByKind.has(availability.kind)) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceAvailability', index, 'kind'],
        message: `Evidence availability kind "${availability.kind}" must be unique`,
      })
    }
    availabilityByKind.set(availability.kind, availability)
  }
  for (const kind of evidenceKinds) {
    if (!availabilityByKind.has(kind)) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceAvailability'],
        message: `Evidence availability must include "${kind}"`,
      })
    }
  }

  const availableKinds = persistedEvidenceKinds(
    attempt.steps,
    attempt.diagnostics,
  )
  for (const [kind, availability] of availabilityByKind) {
    const hasPersistedEvidence = availableKinds.has(kind)
    if (hasPersistedEvidence && availability.state !== 'available') {
      context.addIssue({
        code: 'custom',
        path: ['evidenceAvailability'],
        message: `Evidence availability for "${kind}" must be available when persisted evidence exists`,
      })
    }
    if (!hasPersistedEvidence && availability.state === 'available') {
      context.addIssue({
        code: 'custom',
        path: ['evidenceAvailability'],
        message: `Available evidence for "${kind}" requires persisted evidence`,
      })
    }
  }
}

function validateApplicationOutputAvailability(
  attempt: ScenarioAttempt,
  context: z.RefinementCtx,
): void {
  if (!attempt.applicationOutputAvailability) return
  const streams = new Set<string>()
  const persistedStreams = new Set(
    [
      ...(attempt.diagnostics ?? []),
      ...attempt.steps.flatMap((step) => step.diagnostics ?? []),
    ]
      .filter((entry) => entry.origin === 'application' && entry.stream)
      .map((entry) => entry.stream),
  )
  for (const [
    index,
    availability,
  ] of attempt.applicationOutputAvailability.entries()) {
    if (streams.has(availability.stream)) {
      context.addIssue({
        code: 'custom',
        path: ['applicationOutputAvailability', index, 'stream'],
        message: `Application output stream "${availability.stream}" must be unique`,
      })
    }
    streams.add(availability.stream)
    const hasPersistedOutput = persistedStreams.has(availability.stream)
    if (hasPersistedOutput !== (availability.state === 'available')) {
      context.addIssue({
        code: 'custom',
        path: ['applicationOutputAvailability', index, 'state'],
        message: `Application output availability for "${availability.stream}" must match persisted Diagnostic entries`,
      })
    }
  }
  for (const stream of ['stdout', 'stderr']) {
    if (!streams.has(stream)) {
      context.addIssue({
        code: 'custom',
        path: ['applicationOutputAvailability'],
        message: `Application output availability must include "${stream}"`,
      })
    }
  }
}

const scenarioAttemptSchema: z.ZodType<ScenarioAttempt> = z
  .object({
    attempt: positiveIntegerSchema,
    startedAt: timestampSchema,
    finishedAt: timestampSchema,
    durationMs: nonNegativeIntegerSchema,
    state: resultStateSchema,
    steps: z.array(testStepResultSchema),
    executionMode: z.enum(['adaptive', 'replay']).optional(),
    cacheOutcome: z
      .enum(['hit', 'miss', 'refresh', 'fallback', 'uncacheable'])
      .optional(),
    inferenceCount: nonNegativeIntegerSchema.optional(),
    cacheUncacheableReason: z
      .enum([
        'application-revision-missing',
        'bound-parameter-value',
        'non-deterministic-action',
        'non-deterministic-assertion',
        'payload-validation-failed',
        'entry-too-large',
      ])
      .optional(),
    failureKind: z.literal('cache-miss').optional(),
    message: z.string().optional(),
    fidelityPolicy: fidelityPolicySchema.optional(),
    evidenceAvailability: z.array(evidenceAvailabilitySchema),
    applicationOutputAvailability: z
      .array(applicationOutputEvidenceAvailabilitySchema)
      .optional(),
    diagnostics: z.array(diagnosticEntrySchema).optional(),
  })
  .superRefine((attempt, context) => {
    validateTiming(attempt, context)
    validateEvidenceAvailability(attempt, context)
    validateApplicationOutputAvailability(attempt, context)
  })

const specificationIdentitySchema = z.object({
  name: z.string(),
  uri: z.string(),
})

const scenarioIdentitySchema = z.object({
  name: z.string(),
  id: z.string(),
  examplesId: z.string().optional(),
  examplesRowId: z.string().optional(),
})

const executionTargetProfileSchema = z.object({
  id: z.string(),
  adapter: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
})

const testResultSchema: z.ZodType<TestResult> = z
  .object({
    schemaVersion: z.literal(testRunSchemaVersion),
    specification: specificationIdentitySchema,
    scenario: scenarioIdentitySchema,
    executionTargetProfile: executionTargetProfileSchema,
    state: resultStateSchema,
    startedAt: timestampSchema,
    finishedAt: timestampSchema,
    durationMs: nonNegativeIntegerSchema,
    attempts: z.array(scenarioAttemptSchema).min(1),
    flaky: z.boolean().optional(),
  })
  .superRefine(validateTiming)

const testRunManifestSchema: z.ZodType<TestRunManifest> = z
  .object({
    schemaVersion: z.literal(testRunSchemaVersion),
    id: z.string(),
    startedAt: timestampSchema,
    finishedAt: timestampSchema.optional(),
    sourceRunId: z.string().optional(),
    suite: z.string().optional(),
    applicationRevision: z.string().optional(),
    state: resultStateSchema,
    results: z.array(testResultSchema),
  })
  .superRefine((manifest, context) => {
    if (
      manifest.finishedAt &&
      Date.parse(manifest.finishedAt) < Date.parse(manifest.startedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'finishedAt must not precede startedAt',
      })
    }
  })

const runEventScopeSchema = z.object({
  scenarioId: z.string(),
  examplesRowId: z.string().optional(),
  executionTargetProfileId: z.string(),
  attempt: positiveIntegerSchema,
  stepIndex: nonNegativeIntegerSchema.optional(),
})

const executionCacheKeySchema = z.object({
  projectKey: z.string(),
  scenarioId: z.string(),
  scenarioRevision: z.string(),
  executionTargetProfileId: z.string(),
  targetConfigurationFingerprint: z.string(),
  applicationRevision: z.string(),
  adapterKind: z.string(),
  adapterCacheSchemaVersion: z.string(),
})

const eventEnvelope = {
  schemaVersion: z.literal(testRunSchemaVersion),
  sequence: positiveIntegerSchema,
  occurredAt: timestampSchema,
}

const scopedEvent = {
  scenario: scenarioIdentitySchema,
  executionTargetProfile: executionTargetProfileSchema,
  scope: runEventScopeSchema,
}

const cacheEventTypes = [
  'cache-hit',
  'cache-miss',
  'cache-refresh',
  'replay-diverged',
  'adaptive-fallback-started',
  'cache-written',
] as const

const cacheEventSchemas = cacheEventTypes.map((type) =>
  z.object({
    ...eventEnvelope,
    type: z.literal(type),
    cacheKey: executionCacheKeySchema,
    scope: runEventScopeSchema,
  }),
)

const runEventSchema: z.ZodType<RunEvent> = z.discriminatedUnion('type', [
  z.object({
    ...eventEnvelope,
    type: z.literal('run-started'),
    run: z.object({
      id: z.string(),
      startedAt: timestampSchema,
      sourceRunId: z.string().optional(),
      suite: z.string().optional(),
      applicationRevision: z.string().optional(),
      evidencePersistence: z.enum(['off', 'on-failure', 'always']).optional(),
    }),
  }),
  z.object({
    ...eventEnvelope,
    ...scopedEvent,
    type: z.literal('scenario-started'),
  }),
  z.object({
    ...eventEnvelope,
    ...scopedEvent,
    type: z.literal('step-started'),
    step: scenarioStepSchema,
  }),
  z.object({
    ...eventEnvelope,
    ...scopedEvent,
    type: z.literal('step-finished'),
    result: testStepResultSchema,
  }),
  ...cacheEventSchemas,
  z.object({
    ...eventEnvelope,
    type: z.literal('cache-uncacheable'),
    scope: runEventScopeSchema,
    reason: z.enum([
      'application-revision-missing',
      'bound-parameter-value',
      'non-deterministic-action',
      'non-deterministic-assertion',
      'payload-validation-failed',
      'entry-too-large',
    ]),
  }),
  z.object({
    ...eventEnvelope,
    type: z.literal('inference-count-updated'),
    scope: runEventScopeSchema,
    inferenceCount: nonNegativeIntegerSchema,
  }),
  z.object({
    ...eventEnvelope,
    ...scopedEvent,
    type: z.literal('scenario-finished'),
    specification: specificationIdentitySchema,
    attempt: scenarioAttemptSchema,
    scheduleIndex: nonNegativeIntegerSchema.optional(),
  }),
])

const schemaVersionSchema = z.object({ schemaVersion: z.unknown() })

function parsed<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new Error(result.error.issues[0]?.message ?? `Invalid ${label}`)
}

function requireCurrentSchema(
  value: unknown,
  incompatible: IncompatibleSchema,
): void {
  const envelope = parsed(schemaVersionSchema, value, 'schema envelope')
  if (envelope.schemaVersion !== testRunSchemaVersion) {
    incompatible(envelope.schemaVersion)
  }
}

export function parseTestRunManifest(
  value: unknown,
  incompatible: IncompatibleSchema,
): TestRunManifest {
  requireCurrentSchema(value, incompatible)
  return parsed(testRunManifestSchema, value, 'Test run manifest')
}

export function parseRunEvent(
  value: unknown,
  incompatible: IncompatibleSchema,
): RunEvent {
  requireCurrentSchema(value, incompatible)
  return parsed(runEventSchema, value, 'Run event')
}

export function validateTestResult(
  value: unknown,
  incompatible: IncompatibleSchema,
): TestResult {
  requireCurrentSchema(value, incompatible)
  return parsed(testResultSchema, value, 'Test result')
}
