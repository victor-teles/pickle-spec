import { useEffect, useRef, useState } from 'react'
import type { CurrentScenario } from '../app/command-palette'
import type { StudioScenario, StudioSpecification } from '../server/server'

type UseSpecificationSelectionOptions = {
  onShowSpecifications: (replace?: boolean) => void
  specifications: readonly StudioSpecification[]
}

type RememberedScenario = {
  id: string
  specificationUri: string
}

type SelectionFocus =
  | { kind: 'scenario'; request: number; scenarioId: string }
  | { kind: 'specification'; request: number }

export function useSpecificationSelection(
  options: UseSpecificationSelectionOptions,
) {
  const [selectedId, setSelectedId] = useState<string>()
  const [rememberedScenario, setRememberedScenario] =
    useState<RememberedScenario>()
  const [focus, setFocus] = useState<SelectionFocus>()
  const headingRef = useRef<HTMLHeadingElement>(null)

  const selected =
    options.specifications.find((item) => item.id === selectedId) ??
    options.specifications[0]
  const currentScenario =
    selected && selected.uri === rememberedScenario?.specificationUri
      ? selected.scenarios.find(
          (scenario) => scenario.id === rememberedScenario.id,
        )
      : undefined
  const currentScenarioContext: CurrentScenario | undefined =
    selected && currentScenario
      ? { specification: selected, scenario: currentScenario }
      : undefined

  useEffect(() => {
    if (focus?.kind !== 'specification') return
    headingRef.current?.focus()
  }, [focus])

  function selectSpecification(id: string) {
    setSelectedId(id)
    setRememberedScenario(undefined)
    setFocus(undefined)
  }

  function jumpToSpecification(
    specification: StudioSpecification,
    scenario?: StudioScenario,
  ) {
    options.onShowSpecifications(true)
    setSelectedId(specification.id)
    setRememberedScenario(
      scenario
        ? { id: scenario.id, specificationUri: specification.uri }
        : undefined,
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

  function rememberScenario(scenario: StudioScenario) {
    if (!selected) return
    setRememberedScenario({ id: scenario.id, specificationUri: selected.uri })
  }

  function selectCreatedSpecification(
    specifications: readonly StudioSpecification[],
    uri: string,
  ) {
    const created = specifications.find((item) => item.uri === uri)
    if (created) setSelectedId(created.id)
  }

  return {
    currentScenarioContext,
    focus,
    headingRef,
    jumpToSpecification,
    rememberScenario,
    selectCreatedSpecification,
    selected,
    selectSpecification,
  }
}
