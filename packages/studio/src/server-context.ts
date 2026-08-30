import type { StudioRunsIndex } from './features/history/history.contracts'
import type { StudioProject } from './features/project/project.contracts'

export interface StudioRequestContext {
  studio: {
    loadProject(): Promise<StudioProject>
    listRuns(): Promise<StudioRunsIndex>
  }
}
