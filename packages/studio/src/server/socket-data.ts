import type { DiskChangeEvent } from '../authoring/documents'
import type { StudioRunStreamEvent } from '../features/runs/run.contracts'

export type WorkspaceStreamEvent = DiskChangeEvent & { type: 'disk-changed' }

export type StudioSocketData =
  | {
      kind: 'run'
      runId: string
      listener?: (event: StudioRunStreamEvent) => void
    }
  | {
      kind: 'workspace'
      listener?: (event: WorkspaceStreamEvent) => void
    }
