import { createLazyFileRoute } from '@tanstack/react-router'
import { StudioPage } from '../app/studio-page'

// biome-ignore lint/style/useNamingConvention: TanStack file routes require this export name
export const Route = createLazyFileRoute('/_studio')({
  component: StudioPage,
})
