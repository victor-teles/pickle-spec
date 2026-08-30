import type {
  DiagnosticEntry,
  RunEvent,
  ScheduledTestResult,
  TestRunManifest,
} from '@pickle-spec/runner'
import type { StudioLiveViewportEvent } from './live-viewport'

export interface StudioRunRequest {
  suite?: string
  profiles?: readonly string[]
  paths?: readonly string[]
  scenarioName?: string
  scenarioId?: string
  rerunId?: string
  failures?: boolean
  refreshCache?: boolean
}

export interface StudioRunSnapshot {
  id: string
  events: RunEvent[]
  manifest?: TestRunManifest
  schedule?: readonly ScheduledTestResult[]
}

export type StudioLiveDiagnosticEvent = {
  type: 'diagnostic-recorded'
  profileId: string
  scope?: Extract<RunEvent, { type: 'scenario-started' }>['scope']
  diagnostic: DiagnosticEntry
}

export type StudioRunStreamEvent =
  | RunEvent
  | StudioLiveViewportEvent
  | StudioLiveDiagnosticEvent
  | { type: 'run-scheduled'; schedule: readonly ScheduledTestResult[] }
  | { type: 'run-finished'; run: { id: string } }

export interface StudioRunGateway {
  start(
    request: StudioRunRequest | undefined,
    onEvent: (event: StudioRunStreamEvent) => void,
  ): Promise<{ id: string; done: Promise<unknown> }>
  snapshot(id: string): Promise<StudioRunSnapshot>
  cancel(id: string): Promise<void>
}
