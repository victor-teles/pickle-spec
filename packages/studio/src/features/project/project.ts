import type { StudioAuthoringGateway, StudioProject } from './project.contracts'

interface ProjectOptions {
  authoring?: StudioAuthoringGateway
  loadProject?: () => Promise<StudioProject> | StudioProject
  project: StudioProject
}

export interface StudioProjectModule {
  load(): Promise<StudioProject>
}

export function createProjectModule(
  options: ProjectOptions,
): StudioProjectModule {
  return {
    async load() {
      const project = options.loadProject
        ? await options.loadProject()
        : options.project
      return {
        ...project,
        model: options.authoring?.model ?? project.model,
      }
    },
  }
}
