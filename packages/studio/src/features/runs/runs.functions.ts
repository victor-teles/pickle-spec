import type { StudioRequestContext } from '../../start-context'
import { createServerFn } from '@tanstack/react-start'

export const getStudioRuns = createServerFn({ method: 'GET' }).handler(
  ({ context }): ReturnType<StudioRequestContext['studio']['listRuns']> =>
    context.studio.listRuns(),
)
