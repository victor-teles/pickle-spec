export type { StudioRequestContext } from './server-context'

import type { StudioRequestContext } from './server-context'

declare module '@tanstack/react-router' {
  interface Register {
    server: {
      requestContext: StudioRequestContext
    }
  }
}
