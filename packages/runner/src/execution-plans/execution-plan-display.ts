import type { ExecutionCacheKey } from '../execution-cache/execution-cache'

export type ExecutionPlanTemplateSegment =
  | { kind: 'literal'; value: string }
  | { kind: 'variable'; name: string }
  | { kind: 'redacted' }

export interface ExecutionPlanTemplateDisplay {
  segments: readonly ExecutionPlanTemplateSegment[]
}

export interface ExecutionPlanTargetDisplay {
  selector: ExecutionPlanTemplateDisplay
  nth?: number
}

export interface ExecutionPlanOperationDisplay {
  index: number
  kind: string
  summary: string
  target?: ExecutionPlanTargetDisplay
  value?: ExecutionPlanTemplateDisplay
  check?: string
  editable?: { instructionDigest: string }
}

export interface ExecutionPlanStepDisplay {
  index: number
  keyword: string
  text: string
  operations: readonly ExecutionPlanOperationDisplay[]
}

export interface ExecutionPlanUncachedStep {
  index: number
  keyword: string
  text: string
}

export interface ExecutionPlanDraftDisplay {
  state: 'draft'
  revisionId: string
  parentRevisionId: string | null
  sourceNotice: string
  scope: Readonly<Omit<ExecutionCacheKey, 'projectKey'>>
  requiredVariables: readonly string[]
  steps: readonly ExecutionPlanStepDisplay[]
  uncachedTail: readonly ExecutionPlanUncachedStep[]
}

export type ExecutionPlanApplicability =
  | { state: 'applicable' }
  | {
      state: 'unverified'
      reason: 'current-deployment-unverified'
      storedApplicationRevision: string
    }

export type ExecutionPlanUnavailableReason =
  | 'ambiguous-application-revision'
  | 'coordination-unavailable'
  | 'incompatible-cache-entry'
  | 'scenario-not-found'
  | 'unsupported-adapter'
  | 'unknown-profile'

export type ExecutionPlanDisplay =
  | {
      state: 'absent'
      nextAction: string
    }
  | {
      state: 'unavailable'
      reason: ExecutionPlanUnavailableReason
      message: string
      nextAction: string
      applicationRevisions?: readonly string[]
    }
  | {
      state: 'available'
      source: 'current-cache-entry'
      sourceNotice: string
      publication: { sourceRunId: string }
      cacheKey: ExecutionCacheKey
      cacheRevision: number
      applicability: ExecutionPlanApplicability
      requiredVariables: readonly string[]
      steps: readonly ExecutionPlanStepDisplay[]
      uncachedTail: readonly ExecutionPlanUncachedStep[]
    }
