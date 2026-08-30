import type { Scenario, Specification } from '@pickle-spec/spec'
import type {
  ExecutionCacheEnvelope,
  ExecutionCacheStore,
} from '../execution-cache/execution-cache'
import type {
  ExecutionTargetAdapter,
  ExecutionTargetProfile,
  TargetSessionCompletion,
} from './contracts/execution-target-types'
import type { RunEvent } from './contracts/run-event-types'
import type { ExecutionMode } from './contracts/run-evidence-types'
import type { ScenarioAttempt, TestResult } from './contracts/test-result-types'

export * from './contracts/execution-target-types'
export * from './contracts/run-event-types'
export * from './contracts/run-evidence-types'
export * from './contracts/test-result-types'

export interface ScenarioRun {
  events: RunEvent[]
  result: TestResult
}

export interface RetryPolicy {
  infrastructureErrors: number
  functionalFailures?: number
}

export interface ExecutionTimeouts {
  stepMs?: number
  scenarioMs?: number
}

export interface ExecutionPolicy {
  retry?: RetryPolicy
  timeout?: ExecutionTimeouts
}

export type ExecutionCachePolicy = 'prefer-cache' | 'refresh' | 'cache-only'

export interface ScenarioExecutionCache {
  store: ExecutionCacheStore
  projectKey: string
  sourceRunId: string
}

export interface RunScenarioInput extends ExecutionPolicy {
  specification: Specification
  scenario: Scenario
  executionTargetProfile: ExecutionTargetProfile
  adapter: ExecutionTargetAdapter
  executionCache?: ScenarioExecutionCache
  cachePolicy?: ExecutionCachePolicy
  applicationRevision?: string
  now?: () => Date
  signal?: AbortSignal
  onEvent?: (event: RunEvent) => void | Promise<void>
}

export interface ScenarioAttemptInput extends RunScenarioInput {
  mode: ExecutionMode
  attempt: number
  cacheEntry?: ExecutionCacheEnvelope
}

export interface AttemptScenarioRun extends ScenarioRun {
  attempt: ScenarioAttempt
  completion?: TargetSessionCompletion
  replayDiverged: boolean
  runtimeValueExposed: boolean
  replayedStepCount: number
  adaptiveEvaluated: boolean
}
