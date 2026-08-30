import { createFileRoute } from '@tanstack/react-router'

// biome-ignore lint/style/useNamingConvention: TanStack file routes require this export name
export const Route = createFileRoute('/_studio/')({
  component: StudioRouteBoundary,
})

function StudioRouteBoundary() {
  return null
}
