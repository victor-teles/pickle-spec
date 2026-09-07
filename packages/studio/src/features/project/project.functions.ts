import type { StudioRequestContext } from '../../start-context'
import { createServerFn } from '@tanstack/react-start'

export const getStudioProject = createServerFn({ method: 'GET' }).handler(
  ({ context }): ReturnType<StudioRequestContext['studio']['loadProject']> =>
    context.studio.loadProject(),
)
