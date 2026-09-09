import {
  canonicalJson,
  finalScenarioAttempt,
  openTestRunStore,
  planDigest,
  type PlanResult,
  type ValidationReceipt,
  type ValidationHead,
  type TestRunManifest,
  validationBasisDigest,
} from '@pickle-spec/runner'
import type {
  StudioPlanValidationGateway,
  StudioPlanValidationRequest,
} from '@pickle-spec/studio'
import { startProjectRun } from '../../run/execute-run'
import type { StartProjectRunInput } from '../../run/project-run/types'
import {
  checkoutHead,
  type PlanValidationProject,
  PlanValidationError,
  resolvePlanValidation,
  type ResolvedPlanValidation,
  validationBasis,
} from './context'

type ValidationCallbacks = Pick<
  StartProjectRunInput,
  | 'signal'
  | 'onEvent'
  | 'onSchedule'
  | 'onApplicationDiagnostic'
  | 'onLiveViewport'
  | 'onResult'
>
type ReviewRequest = Pick<
  StudioPlanValidationRequest,
  'revisionId' | 'reviewId'
>

async function asResult<Value>(
  work: () => Promise<Value>,
): Promise<PlanResult<Value>> {
  try {
    return { ok: true, value: await work() }
  } catch (error) {
    if (error instanceof PlanValidationError)
      return { ok: false, reason: error.reason, message: error.message }
    return {
      ok: false,
      reason: 'invalid-payload',
      message:
        'Validation could not read the current project or its saved proof. Check the configuration and saved candidate.',
    }
  }
}

async function reviewedContext(
  project: PlanValidationProject,
  request: ReviewRequest,
) {
  const context = await resolvePlanValidation(project, request.revisionId)
  const loaded = await context.local.readReview(request.reviewId)
  if (
    !loaded.ok ||
    !loaded.value ||
    loaded.value.candidateId !== context.revision.id ||
    loaded.value.baselineId !== context.baseline.id ||
    loaded.value.scenarioRevision !== context.key.scenarioRevision
  ) {
    throw new PlanValidationError(
      'specification-review-required',
      'Review this exact candidate against the original Specification before validation.',
    )
  }
  return context
}

function passingValidation(
  context: ResolvedPlanValidation,
  manifest: TestRunManifest,
) {
  const result = manifest.results[0]
  if (
    manifest.results.length !== 1 ||
    !result ||
    result.state !== 'passed' ||
    result.attempts.length !== 1
  )
    return false
  const attempt = finalScenarioAttempt(result)
  return (
    attempt.state === 'passed' &&
    attempt.executionMode === 'replay' &&
    attempt.inferenceCount === 0 &&
    attempt.planUse?.revisionId === context.revision.id &&
    attempt.planUse.purpose === 'validation' &&
    attempt.steps.length === context.selection.scenario.steps.length &&
    attempt.steps.every((step) => step.state === 'passed')
  )
}

interface CompleteValidationInput {
  context: ResolvedPlanValidation
  request: StudioPlanValidationRequest
  manifest: TestRunManifest
  project: PlanValidationProject
  head: string | null
  aborted: boolean
  completed: boolean
}

async function completeValidation(input: CompleteValidationInput) {
  const { context, manifest, request } = input
  const basisDigest = validationBasis(context, request.reviewId)
  let fresh = false
  try {
    const current = await reviewedContext(input.project, request)
    fresh =
      validationBasis(current, request.reviewId) === basisDigest &&
      checkoutHead(context.root) === input.head
  } catch {
    fresh = false
  }
  const cancelled = input.aborted || manifest.state === 'cancelled'
  const passed =
    input.completed &&
    !cancelled &&
    fresh &&
    passingValidation(context, manifest)
  const run = {
    projectKey: context.key.projectKey,
    runId: manifest.id,
    resultDigest: planDigest(JSON.parse(JSON.stringify(manifest))),
  }
  const receipt: Omit<ValidationReceipt, 'id'> | null = passed
    ? {
        revisionId: context.revision.id,
        key: context.key,
        inputSnapshotDigest: context.inputSnapshotDigest,
        assertionDigest: context.assertionDigest,
        intentReviewDigest: request.reviewId,
        validationRun: run,
        adapterValidatorVersion: context.adapterValidatorVersion,
        validatedAt: new Date().toISOString(),
        result: 'passed',
        inferenceCount: 0,
      }
    : null
  let outcome: ValidationHead['outcome'] = 'failed'
  if (cancelled) outcome = 'cancelled'
  else if (passed) outcome = 'passed'
  const published = await context.local.publish({
    scope: context.revision.scope,
    basisDigest,
    run,
    outcome,
    receipt,
  })
  if (!published.ok)
    throw new PlanValidationError(published.reason, published.message)
  return published.value
}

async function receiptIsCurrent(
  context: ResolvedPlanValidation,
  reviewId: string,
  basisDigest: string,
  head: ValidationHead,
  receipt: ValidationReceipt,
): Promise<boolean> {
  if (
    receipt.id !== head.receiptId ||
    validationBasisDigest(receipt) !== basisDigest ||
    canonicalJson(receipt.key) !== canonicalJson(context.key) ||
    canonicalJson(receipt.validationRun) !== canonicalJson(head.run) ||
    receipt.revisionId !== context.revision.id ||
    receipt.intentReviewDigest !== reviewId
  ) {
    return false
  }
  try {
    const persisted = await openTestRunStore({ root: context.root }).open(
      head.run.runId,
    )
    const manifest = await persisted.materialize()
    return (
      manifest.finishedAt !== undefined &&
      planDigest(JSON.parse(JSON.stringify(manifest))) === head.run.resultDigest
    )
  } catch {
    return false
  }
}

export function createStudioPlanValidationService(
  project: PlanValidationProject,
) {
  const gateway: StudioPlanValidationGateway = {
    inspect: (request) =>
      asResult(async () => {
        const context = await resolvePlanValidation(project, request.revisionId)
        return {
          revisionId: context.revision.id,
          baselineId: context.baseline.id,
          baselineSteps: context.baselineSteps,
          candidateSteps: context.candidateSteps,
        }
      }),
    review: (request) =>
      asResult(async () => {
        const context = await resolvePlanValidation(project, request.revisionId)
        const reviewed = await context.local.writeReview({
          reviewer: { kind: 'human', id: 'studio' },
          candidateId: context.revision.id,
          baselineId: context.baseline.id,
          scenarioRevision: context.key.scenarioRevision,
          decision: 'preserves-specification',
          rationale: request.rationale,
          evidenceRunIds: request.evidenceRunIds,
        })
        if (!reviewed.ok)
          throw new PlanValidationError(reviewed.reason, reviewed.message)
        return { reviewId: reviewed.value.id }
      }),
    status: (request) =>
      asResult(async () => {
        const context = await reviewedContext(project, request)
        const basisDigest = validationBasis(context, request.reviewId)
        const latest = await context.local.readHead(basisDigest)
        if (!latest.ok)
          throw new PlanValidationError(latest.reason, latest.message)
        if (!latest.value) return { state: 'draft' as const }
        const head = latest.value
        if (head.outcome !== 'passed')
          return { state: head.outcome, runId: head.run.runId }
        if (!head.receiptId)
          throw new PlanValidationError(
            'stale-validation',
            'The passing validation receipt is unavailable.',
          )
        const receipt = await context.local.readReceipt(head.receiptId)
        if (
          !receipt.ok ||
          !receipt.value ||
          !(await receiptIsCurrent(
            context,
            request.reviewId,
            basisDigest,
            head,
            receipt.value,
          ))
        ) {
          throw new PlanValidationError(
            'stale-validation',
            'The candidate requires another validation run.',
          )
        }
        return {
          state: 'validated' as const,
          runId: head.run.runId,
          receipt: receipt.value,
        }
      }),
  }
  return {
    ...gateway,
    async start(
      request: StudioPlanValidationRequest,
      callbacks: ValidationCallbacks,
    ) {
      if (!request.resetConfirmed)
        throw new PlanValidationError(
          'validation-required',
          'Reset the application to the Scenario starting state before validation.',
        )
      const context = await reviewedContext(project, request)
      const head = checkoutHead(context.root)
      const started = await startProjectRun({
        ...callbacks,
        root: context.root,
        config: context.config,
        options: context.options,
        executionPlanValidation: {
          authoredReplay: {
            replay: {
              adapterPayload: context.payload,
              requiredVariables: context.revision.requiredVariables,
            },
            planUse: {
              revisionId: context.revision.id,
              selectionDigest: null,
              key: context.key,
              payloadDigest: planDigest(context.payload),
              author: context.revision.author,
              origin: context.revision.origin,
              purpose: 'validation',
              validationId: null,
            },
          },
        },
      })
      const done = started.done.then(
        async (result) => {
          await completeValidation({
            context,
            request,
            manifest: result.manifest,
            project,
            head,
            aborted: callbacks.signal?.aborted ?? false,
            completed: true,
          })
          return result
        },
        async (error) => {
          const run = await openTestRunStore({ root: context.root }).open(
            started.id,
          )
          const manifest = await run.materialize()
          await completeValidation({
            context,
            request,
            manifest,
            project,
            head,
            aborted: callbacks.signal?.aborted ?? false,
            completed: false,
          })
          throw error
        },
      )
      return { id: started.id, done }
    },
  }
}

export type StudioPlanValidationService = ReturnType<
  typeof createStudioPlanValidationService
>
