import { useEffect, useRef, useState } from 'react'
import type { CurrentScenario } from '../app/command-palette'
import type { StudioRoute } from '../app/studio-route'
import type { StudioScenario, StudioSpecification } from '../server/server'

type UseSpecificationSelectionOptions = {
  navigate: (route: StudioRoute, replace?: boolean) => void
  route: StudioRoute
  specifications: readonly StudioSpecification[]
}

export type MissingSpecificationSelection =
  | { kind: 'specification'; specificationId: string }
  | {
      kind: 'scenario'
      specificationId: string
      scenarioId: string
    }

type ResolvedSpecificationSelection = {
  selected?: StudioSpecification
  currentScenario?: StudioScenario
  missing?: MissingSpecificationSelection
}

type SelectionFocus =
  | { kind: 'scenario'; request: number; scenarioId: string }
  | { kind: 'specification'; request: number }

export function resolveSpecificationSelection(
  route: StudioRoute,
  specifications: readonly StudioSpecification[],
): ResolvedSpecificationSelection {
  if (route.kind === 'specifications') return { selected: specifications[0] }
  if (route.kind !== 'specification' && route.kind !== 'scenario') return {}

  const selected = specifications.find(
    (specification) => specification.id === route.specificationId,
  )
  if (!selected) {
    return {
      missing: {
        kind: 'specification',
        specificationId: route.specificationId,
      },
    }
  }
  if (route.kind === 'specification') return { selected }

  const currentScenario = selected.scenarios.find(
    (scenario) => scenario.id === route.scenarioId,
  )
  return currentScenario
    ? { selected, currentScenario }
    : {
        selected,
        missing: {
          kind: 'scenario',
          specificationId: route.specificationId,
          scenarioId: route.scenarioId,
        },
      }
}

export function useSpecificationSelection(
  options: UseSpecificationSelectionOptions,
) {
  const [focus, setFocus] = useState<SelectionFocus>()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const resolved = resolveSpecificationSelection(
    options.route,
    options.specifications,
  )
  const currentScenarioContext: CurrentScenario | undefined =
    resolved.selected && resolved.currentScenario
      ? {
          specification: resolved.selected,
          scenario: resolved.currentScenario,
        }
      : undefined

  useEffect(() => {
    if (focus?.kind !== 'specification') return
    headingRef.current?.focus()
  }, [focus])

  function selectSpecification(specificationId: string) {
    options.navigate({ kind: 'specification', specificationId })
    setFocus(undefined)
  }

  function jumpToSpecification(
    specification: StudioSpecification,
    scenario?: StudioScenario,
  ) {
    options.navigate(
      scenario
        ? {
            kind: 'scenario',
            specificationId: specification.id,
            scenarioId: scenario.id,
          }
        : { kind: 'specification', specificationId: specification.id },
    )
    if (scenario) {
      setFocus((current) => ({
        kind: 'scenario',
        request: (current?.request ?? 0) + 1,
        scenarioId: scenario.id,
      }))
      return
    }
    setFocus((current) => ({
      kind: 'specification',
      request: (current?.request ?? 0) + 1,
    }))
  }

  function selectScenario(scenario: StudioScenario) {
    if (!resolved.selected) return
    options.navigate({
      kind: 'scenario',
      specificationId: resolved.selected.id,
      scenarioId: scenario.id,
    })
  }

  function selectCreatedSpecification(
    specifications: readonly StudioSpecification[],
    uri: string,
  ) {
    const created = specifications.find((item) => item.uri === uri)
    if (created) {
      options.navigate({
        kind: 'specification',
        specificationId: created.id,
      })
    }
  }

  return {
    currentScenarioContext,
    focus,
    headingRef,
    jumpToSpecification,
    missing: resolved.missing,
    selectCreatedSpecification,
    selected: resolved.selected,
    selectScenario,
    selectSpecification,
  }
}
