import { useCallback, useEffect, useState } from 'react'
import {
  parseStudioRoute,
  type StudioRoute,
  studioRouteHref,
} from './studio-route'

export const studioAreas = ['Specifications', 'Runs', 'Settings'] as const

export type StudioArea = (typeof studioAreas)[number]

function currentStudioRoute(): StudioRoute {
  return parseStudioRoute(
    typeof location === 'undefined' ? 'http://studio.local/' : location.href,
  )
}

function areaForRoute(route: StudioRoute): StudioArea {
  return route.kind === 'runs' ||
    route.kind === 'run' ||
    route.kind === 'result' ||
    route.kind === 'artifact'
    ? 'Runs'
    : 'Specifications'
}

export function useStudioNavigation() {
  const [route, setRoute] = useState(currentStudioRoute)
  const [area, setArea] = useState<StudioArea>(() =>
    areaForRoute(currentStudioRoute()),
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
    const initialStudioRoute = currentStudioRoute()
    if (
      initialStudioRoute.kind !== 'not-found' &&
      new URLSearchParams(location.search).has('token')
    ) {
      history.replaceState(null, '', studioRouteHref(initialStudioRoute))
    }
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
