import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import './start-context'

export default createServerEntry({
  fetch(request, options) {
    return handler.fetch(request, options)
  },
})
