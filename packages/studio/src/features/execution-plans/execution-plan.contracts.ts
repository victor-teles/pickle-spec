import type {
  Digest,
  ExecutionPlanDisplay,
  ExecutionPlanDraftDisplay,
  PlanResult,
  StepIdentity,
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

export interface StudioExecutionPlanEditRequest
  extends StudioExecutionPlanRequest {
  parentRevisionId: Digest
  step: StepIdentity
  instructionIndex: number
  expectedInstructionDigest: Digest
  locator: StudioWebLocator
}

export type StudioExecutionPlanDraftResult =
  PlanResult<ExecutionPlanDraftDisplay>

export interface StudioExecutionPlanGateway {
  read(request: StudioExecutionPlanRequest): Promise<ExecutionPlanDisplay>
  captureDraft(
    request: StudioExecutionPlanRequest,
  ): Promise<StudioExecutionPlanDraftResult>
  edit(
    request: StudioExecutionPlanEditRequest,
  ): Promise<StudioExecutionPlanDraftResult>
}
