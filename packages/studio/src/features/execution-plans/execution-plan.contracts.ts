import type {
  Digest,
  ExecutionPlanDisplay,
  ExecutionPlanDraftDisplay,
  PlanResult,
  StepIdentity,
  ExecutionPlanStepDisplay,
  ValidationReceipt,
} from '@pickle-spec/runner'

export interface StudioExecutionPlanRequest {
  scenarioId: string
  profileId: string
  applicationRevision?: string
}

export type StudioWebLocator = {
  selector: {
    segments: Array<{ literal: string } | { variable: string }>
  }
  nth?: number
}

export interface StudioExecutionPlanEditRequest extends StudioExecutionPlanRequest {
  parentRevisionId: Digest
  step: StepIdentity
  instructionIndex: number
  expectedInstructionDigest: Digest
  locator: StudioWebLocator
}

export type StudioExecutionPlanDraftResult =
  PlanResult<ExecutionPlanDraftDisplay>

export interface StudioExecutionPlanGateway {
  validation?: StudioPlanValidationGateway
  read(request: StudioExecutionPlanRequest): Promise<ExecutionPlanDisplay>
  captureDraft(
    request: StudioExecutionPlanRequest,
  ): Promise<StudioExecutionPlanDraftResult>
  edit(
    request: StudioExecutionPlanEditRequest,
  ): Promise<StudioExecutionPlanDraftResult>
}

export interface StudioPlanValidationReview {
  revisionId: Digest
  rationale: string
  evidenceRunIds: string[]
}

export interface StudioPlanValidationRequest {
  revisionId: Digest
  reviewId: Digest
  resetConfirmed: true
}

export interface StudioPlanValidationInspection {
  revisionId: Digest
  baselineId: Digest
  baselineSteps: readonly ExecutionPlanStepDisplay[]
  candidateSteps: readonly ExecutionPlanStepDisplay[]
}

export type StudioPlanValidationStatus =
  | { state: 'draft' }
  | { state: 'validated'; runId: string; receipt: ValidationReceipt }
  | { state: 'failed' | 'cancelled'; runId: string }

export interface StudioPlanValidationGateway {
  inspect(request: {
    revisionId: Digest
  }): Promise<PlanResult<StudioPlanValidationInspection>>
  review(
    request: StudioPlanValidationReview,
  ): Promise<PlanResult<{ reviewId: Digest }>>
  status(
    request: Pick<StudioPlanValidationRequest, 'revisionId' | 'reviewId'>,
  ): Promise<PlanResult<StudioPlanValidationStatus>>
}
