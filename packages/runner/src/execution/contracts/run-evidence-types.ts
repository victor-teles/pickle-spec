import type {
  CacheOutcome,
  ExecutionCacheKey,
  ExecutionCacheUncacheableReason,
} from '../../execution-cache/execution-cache'

export type TestResultState =
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'infrastructure-error'

export function isEvidenceState(state: TestResultState): boolean {
  return state === 'failed' || state === 'infrastructure-error'
}

export type ExecutionMode = 'adaptive' | 'replay'

export const testRunSchemaVersion = 2 as const
export const sharedEvidenceObservationVersion = 1 as const
export const actionEvidenceVersion = 1 as const

export interface ResolvedAction {
  description: string
  replay?: Record<string, unknown>
  evidence?: ActionEvidence
}

export interface ActionTargetState {
  format: 'summary'
  summary: string
  location?: string
}

export type ActionScreenshot =
  | { state: 'available'; artifact: TestArtifact }
  | {
      state: Exclude<EvidenceAvailabilityState, 'available'>
      message?: string
    }

export interface ActionSourceEvidence {
  uri: string
  language: string
  line?: number
  column?: number
  excerpt: string
}

export interface ActionEvidence {
  version: typeof actionEvidenceVersion
  id: string
  ordinal: number
  description: string
  startedAt: string
  finishedAt: string
  durationMs: number
  state: 'passed' | 'failed'
  message?: string
  source: ActionSourceEvidence
  target: {
    before: ActionTargetState
    after: ActionTargetState
  }
  screenshots: {
    before: ActionScreenshot
    after: ActionScreenshot
  }
  diagnostics: DiagnosticEntry[]
  activity: TraceEntry[]
}

export interface ActionEvidenceInput {
  description: string
  startedAt: string
  finishedAt: string
  state: 'passed' | 'failed'
  message?: string
  target: ActionEvidence['target']
  screenshots: ActionEvidence['screenshots']
  diagnostics?: DiagnosticEntry[]
  activity?: TraceEntry[]
}

export interface RunEventRange {
  startSequence: number
  endSequence: number
}

export interface ArtifactEvidenceLink {
  stepIndex: number
  eventRange: RunEventRange
}

export interface TestArtifact {
  kind: 'screenshot' | 'trace' | 'recording' | 'device-log'
  path: string
  mediaType?: string
  name?: string
  capturedAt?: string
  sizeBytes?: number
  evidenceLink?: ArtifactEvidenceLink
}

export const evidenceKinds = [
  'screenshot',
  'trace',
  'recording',
  'device-log',
  'diagnostics',
] as const

export type EvidenceKind = (typeof evidenceKinds)[number]

export type EvidenceAvailabilityState =
  | 'available'
  | 'not-requested'
  | 'not-supported'
  | 'not-retained'
  | 'capture-failed'
  | 'missing'

export interface EvidenceAvailability {
  kind: EvidenceKind
  state: EvidenceAvailabilityState
  message?: string
}

export interface ApplicationOutputEvidenceAvailability {
  stream: 'stdout' | 'stderr'
  state: EvidenceAvailabilityState
  message?: string
}

export const diagnosticLevels = ['debug', 'info', 'warning', 'error'] as const
export type DiagnosticLevel = (typeof diagnosticLevels)[number]

export const diagnosticOrigins = [
  'console',
  'network',
  'runner',
  'adapter',
  'application',
] as const
export type DiagnosticOrigin = (typeof diagnosticOrigins)[number]

export interface DiagnosticEntry {
  occurredAt: string
  causalAt?: string
  level: DiagnosticLevel
  origin: DiagnosticOrigin
  stream?: 'stdout' | 'stderr'
  message: string
  scenarioId?: string
  scenarioName?: string
  stepIndex?: number
  stepText?: string
  executionTargetProfileId?: string
}

export const traceActivityKinds = [
  'resolved-action',
  'browser-activity',
] as const
export type TraceActivityKind = (typeof traceActivityKinds)[number]

export interface TraceEntry {
  occurredAt: string
  causalAt?: string
  kind: TraceActivityKind
  description: string
}

export interface SharedEvidenceTiming {
  occurredAt: string
  precision: 'exact' | 'step-finish' | 'attempt-finish'
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  causalAt?: string
}

export interface SharedEvidenceVersionObservation {
  subject: 'contract' | 'application' | 'scenario' | 'adapter'
  label: string
  value: string
}

export interface SharedEvidenceActivity {
  kind: TraceActivityKind
  description: string
}

export interface SharedEvidenceOutcome {
  state?: TestResultState
  level?: DiagnosticLevel
  message?: string
}

export interface SharedEvidenceCost {
  inferenceCount: number
}

export const sharedEvidenceCacheDecisionTypes = [
  'cache-hit',
  'cache-miss',
  'cache-refresh',
  'replay-diverged',
  'adaptive-fallback-started',
  'cache-written',
  'cache-uncacheable',
] as const
export type SharedEvidenceCacheDecisionType =
  (typeof sharedEvidenceCacheDecisionTypes)[number]

export interface SharedEvidenceExecution {
  mode?: ExecutionMode
  cacheOutcome?: CacheOutcome
  cacheDecision?: {
    type: SharedEvidenceCacheDecisionType
    reason?: ExecutionCacheUncacheableReason
    cacheKey?: ExecutionCacheKey
  }
}

export interface SharedEvidenceObservation {
  version: typeof sharedEvidenceObservationVersion
  kind: 'activity' | 'diagnostic' | 'artifact' | 'outcome' | 'cache'
  summary: string
  timing: SharedEvidenceTiming
  versions?: readonly SharedEvidenceVersionObservation[]
  activity?: SharedEvidenceActivity
  outcome?: SharedEvidenceOutcome
  cost?: SharedEvidenceCost
  artifact?: TestArtifact
  execution?: SharedEvidenceExecution
}
