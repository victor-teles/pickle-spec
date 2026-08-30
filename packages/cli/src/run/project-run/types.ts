import type { MobileLiveViewportUpdate } from '@pickle-spec/mobile'
import type {
  EvidencePersistencePolicy,
  RunEvent,
  ScenarioRun,
  ScheduledTestResult,
  TestResult,
  TestRunManifest,
} from '@pickle-spec/runner'
import type { SelectionOptions } from '@pickle-spec/spec'
import type { WebAdapterOptions, WebLiveViewportUpdate } from '@pickle-spec/web'
import type { PickleConfig } from '../../configuration/config'
import type { LiveApplicationDiagnostic } from '../application-diagnostics'
import type { ApplicationOutputOptions } from '../application-output'

export type ProjectLiveViewportUpdate =
  | WebLiveViewportUpdate
  | MobileLiveViewportUpdate

export interface ProjectRunOptions {
  pattern?: string
  extensionsPath?: string
  suite?: string
  profiles?: string[]
  selection?: SelectionOptions
  retries?: number
  concurrency?: number
  language?: string
  scenarioTimeoutMs?: number
  stepTimeoutMs?: number
  reuseServer?: boolean
  headed?: boolean
  screenshotMode?: NonNullable<WebAdapterOptions['screenshots']>['mode']
  applicationRevision?: string
  rerunId?: string
  scenarioIds?: string[]
  failures?: boolean
  fast?: boolean
  refreshCache?: boolean
  cacheOnly?: boolean
  applicationOutput?: ApplicationOutputOptions
  evidencePersistence?: EvidencePersistencePolicy
}

export type ProjectRunResult = {
  runs: ScenarioRun[]
  manifest: TestRunManifest
}

export interface StartedProjectRun {
  id: string
  done: Promise<ProjectRunResult>
}

export type StartProjectRunInput = {
  root: string
  config: PickleConfig
  options?: ProjectRunOptions
  signal?: AbortSignal
  onEvent?: (event: RunEvent) => void | Promise<void>
  onApplicationDiagnostic?: (event: LiveApplicationDiagnostic) => void
  onLiveViewport?: (update: ProjectLiveViewportUpdate) => void
  onSchedule?: (
    schedule: readonly ScheduledTestResult[],
  ) => void | Promise<void>
  onResult?: (result: TestResult) => void | Promise<void>
}
