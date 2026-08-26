import { useCallback, useEffect, useState } from 'react'
import {
  parseStudioRoute,
  type StudioRoute,
  studioRouteHref,
} from './studio-route'

export const studioAreas = ['Specifications', 'Runs', 'Settings'] as const

export type StudioArea = (typeof studioAreas)[number]

const initialStudioRoute = parseStudioRoute(location.href)

function areaForRoute(route: StudioRoute): StudioArea {
  return route.kind === 'runs' ||
    route.kind === 'run' ||
    route.kind === 'result'
    ? 'Runs'
    : 'Specifications'
}

export function useStudioNavigation() {
  const [route, setRoute] = useState(initialStudioRoute)
  const [area, setArea] = useState<StudioArea>(() =>
    areaForRoute(initialStudioRoute),
  )

  const navigate = useCallback((next: StudioRoute, replace = false) => {
    if (next.kind === 'not-found') return
    const href = studioRouteHref(next)
    if (replace) history.replaceState(null, '', href)
    else history.pushState(null, '', href)
    setRoute(next)
    setArea(areaForRoute(next))
  }, [])

  const showArea = useCallback(
    (nextArea: StudioArea, replace = false) => {
      if (nextArea === 'Runs') {
        navigate({ kind: 'runs', filters: {} }, replace)
        return
      }
      if (replace) history.replaceState(null, '', '/')
      else history.pushState(null, '', '/')
      setRoute({ kind: 'specifications' })
      setArea(nextArea)
    },
    [navigate],
  )

  useEffect(() => {
    function restoreLocation() {
      const next = parseStudioRoute(location.href)
      setRoute(next)
      setArea(areaForRoute(next))
    }
    addEventListener('popstate', restoreLocation)
    return () => removeEventListener('popstate', restoreLocation)
  }, [])

  return { area, navigate, route, showArea }
}
