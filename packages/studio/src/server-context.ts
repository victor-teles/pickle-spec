import type { StudioExecutionPlanGateway } from './features/execution-plans/execution-plan.contracts'
import type { StudioRunsIndex } from './features/history/history.contracts'
import type { StudioProject } from './features/project/project.contracts'

export interface StudioRequestContext {
  studio: {
    loadProject(): Promise<StudioProject>
    listRuns(): Promise<StudioRunsIndex>
    executionPlans?: StudioExecutionPlanGateway
  }
}
