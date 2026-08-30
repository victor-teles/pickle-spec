import { createServerFn } from '@tanstack/react-start'
import '../../start-context'

export const getStudioRuns = createServerFn({ method: 'GET' }).handler(
  ({ context }) => context.studio.listRuns(),
)
