import { createServerFn } from '@tanstack/react-start'
import '../../start-context'

export const getStudioProject = createServerFn({ method: 'GET' }).handler(
  ({ context }) => context.studio.loadProject(),
)
