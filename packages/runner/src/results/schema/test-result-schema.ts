import { z } from 'zod'
import { persistedEvidenceKinds } from '../../evidence/evidence'
import type {
  ScenarioAttempt,
  TestResult,
  TestStepResult,
} from '../../execution/run-scenario'
import {
  evidenceKinds,
  testRunSchemaVersion,
} from '../../execution/run-scenario'
import type { TestRunManifest } from '../test-run-store'
import { resolvedActionSchema } from './run-evidence-schema'
import {
  artifactSchema,
  cacheOutcomeSchema,
  cacheUncacheableReasonSchema,
  diagnosticEntrySchema,
  evidenceStateSchema,
  executionTargetProfileSchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
  resultStateSchema,
  scenarioIdentitySchema,
  scenarioStepSchema,
  specificationIdentitySchema,
  timestampSchema,
  traceEntrySchema,
  validateTiming,
} from './run-schema-primitives'

export const testStepResultSchema: z.ZodType<TestStepResult> = z
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
  state: evidenceStateSchema,
  message: z.string().optional(),
})

const applicationOutputEvidenceAvailabilitySchema = z.object({
  stream: z.enum(['stdout', 'stderr']),
  state: evidenceStateSchema,
  message: z.string().optional(),
})

type EvidenceKind = ScenarioAttempt['evidenceAvailability'][number]['kind']
type EvidenceAvailability = ScenarioAttempt['evidenceAvailability'][number]

function validateEvidenceAvailability(
  attempt: ScenarioAttempt,
  context: z.RefinementCtx,
): void {
  const availabilityByKind = new Map<EvidenceKind, EvidenceAvailability>()
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
  validateRequiredEvidenceKinds(availabilityByKind, context)

  const availableKinds = persistedEvidenceKinds(
    attempt.steps,
    attempt.diagnostics,
  )
  for (const [kind, availability] of availabilityByKind) {
    validatePersistedEvidenceKind(kind, availability, availableKinds, context)
  }
}

function validateRequiredEvidenceKinds(
  availabilityByKind: ReadonlyMap<EvidenceKind, EvidenceAvailability>,
  context: z.RefinementCtx,
): void {
  for (const kind of evidenceKinds) {
    if (availabilityByKind.has(kind)) continue
    context.addIssue({
      code: 'custom',
      path: ['evidenceAvailability'],
      message: `Evidence availability must include "${kind}"`,
    })
  }
}

function validatePersistedEvidenceKind(
  kind: EvidenceKind,
  availability: EvidenceAvailability,
  availableKinds: ReadonlySet<EvidenceKind>,
  context: z.RefinementCtx,
): void {
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

export const scenarioAttemptSchema: z.ZodType<ScenarioAttempt> = z
  .object({
    attempt: positiveIntegerSchema,
    startedAt: timestampSchema,
    finishedAt: timestampSchema,
    durationMs: nonNegativeIntegerSchema,
    state: resultStateSchema,
    steps: z.array(testStepResultSchema),
    executionMode: z.enum(['adaptive', 'replay']).optional(),
    cacheOutcome: cacheOutcomeSchema.optional(),
    inferenceCount: nonNegativeIntegerSchema.optional(),
    prefixStepCount: positiveIntegerSchema.optional(),
    cacheUncacheableReason: cacheUncacheableReasonSchema.optional(),
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

export const testResultSchema: z.ZodType<TestResult> = z
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

export const testRunManifestSchema: z.ZodType<TestRunManifest> = z
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
