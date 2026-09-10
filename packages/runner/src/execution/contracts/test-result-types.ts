import type { ScenarioStep } from '@pickle-spec/spec'
import type {
  CacheOutcome,
  ExecutionCacheUncacheableReason,
} from '../../execution-cache/execution-cache'
import type {
  ExecutionTargetProfile,
  FidelityPolicy,
} from './execution-target-types'
import type {
  ApplicationOutputEvidenceAvailability,
  DiagnosticEntry,
  EvidenceAvailability,
  ExecutionMode,
  ResolvedAction,
  TestArtifact,
  TestResultState,
  TraceEntry,
  TestRunSchemaVersion,
} from './run-evidence-types'
import type { PlanUse } from '../../execution-plans/execution-plan-revision'

export interface ScenarioIdentity {
  name: string
  id?: string
  examplesId?: string
  examplesRowId?: string
}

export interface TestStepResult {
  index: number
  startedAt: string
  finishedAt: string
  durationMs: number
  step: ScenarioStep
  state: TestResultState
  resolvedActions: ResolvedAction[]
  message?: string
  artifacts?: TestArtifact[]
  diagnostics?: DiagnosticEntry[]
  trace?: TraceEntry[]
}

export interface ScenarioAttempt {
  attempt: number
  startedAt: string
  finishedAt: string
  durationMs: number
  state: TestResultState
  steps: TestStepResult[]
  executionMode?: ExecutionMode
  cacheOutcome?: CacheOutcome
  inferenceCount?: number
  prefixStepCount?: number
  cacheUncacheableReason?: ExecutionCacheUncacheableReason
  failureKind?: 'cache-miss'
  message?: string
  fidelityPolicy?: FidelityPolicy
  evidenceAvailability: EvidenceAvailability[]
  applicationOutputAvailability?: ApplicationOutputEvidenceAvailability[]
  diagnostics?: DiagnosticEntry[]
  planUse?: PlanUse
}

export interface TestResult {
  schemaVersion: TestRunSchemaVersion
  specification: {
    name: string
    uri: string
  }
  scenario: ScenarioIdentity
  executionTargetProfile: ExecutionTargetProfile
  state: TestResultState
  startedAt: string
  finishedAt: string
  durationMs: number
  attempts: ScenarioAttempt[]
  flaky?: boolean
}

export function finalScenarioAttempt(result: TestResult): ScenarioAttempt {
  const attempt = result.attempts.at(-1)
  if (!attempt) {
    throw new Error('A Test result requires at least one Scenario attempt')
  }
  return attempt
}
