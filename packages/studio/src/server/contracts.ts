import type { SpecificationWorkspace } from '../features/documents/documents'
import type { StudioExecutionCacheGateway } from '../features/execution-cache/execution-cache.contracts'
import type { StudioHistoryGateway } from '../features/history/history.contracts'
import type {
  StudioAuthoringGateway,
  StudioManagementGateway,
  StudioProject,
} from '../features/project/project.contracts'
import type { StudioRunGateway } from '../features/runs/run.contracts'
import type { GitWorkspace } from './git'

export type * from '../features/execution-cache/execution-cache.contracts'
export type * from '../features/history/history.contracts'
export type * from '../features/project/project.contracts'
export type * from '../features/runs/run.contracts'

export interface StudioOptions {
  project: StudioProject
  loadProject?: () => Promise<StudioProject> | StudioProject
  gateway?: StudioRunGateway
  history?: StudioHistoryGateway
  documents?: SpecificationWorkspace
  authoring?: StudioAuthoringGateway
  management?: StudioManagementGateway
  executionCache?: StudioExecutionCacheGateway
  git?: GitWorkspace
  specificationGlobs?: string | readonly string[]
  language?: string
  hostname?: string
  allowRemoteAccess?: boolean
  port?: number
  token?: string
  open?: boolean
}

export interface StudioServer {
  url: string
  token: string
  stop(): void
}
