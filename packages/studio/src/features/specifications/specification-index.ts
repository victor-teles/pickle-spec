import type {
  StudioScenario,
  StudioSpecification,
} from '../../server/contracts'

export type SpecificationIndexScope = 'all' | 'specifications' | 'scenarios'

export type SpecificationIndexEntry = {
  scenarios: readonly StudioScenario[]
  specification: StudioSpecification
}

function includesQuery(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query)
}

function matchingScenarios(
  scenarios: readonly StudioScenario[],
  query: string,
): readonly StudioScenario[] {
  if (!query) return scenarios
  return scenarios.filter((scenario) => includesQuery(scenario.name, query))
}

export function filterSpecificationIndex(
  specifications: readonly StudioSpecification[],
  scope: SpecificationIndexScope,
  rawQuery: string,
): readonly SpecificationIndexEntry[] {
  const query = rawQuery.trim().toLocaleLowerCase()

  if (scope === 'specifications') {
    return specifications
      .filter((specification) => specificationMatches(specification, query))
      .map((specification) => ({
        specification,
        scenarios: specification.scenarios,
      }))
  }

  if (scope === 'scenarios') {
    return specifications.flatMap((specification) => {
      const scenarios = matchingScenarios(specification.scenarios, query)
      return scenarios.length ? [{ specification, scenarios }] : []
    })
  }

  return specifications.flatMap((specification) => {
    const matchesSpecification = specificationMatches(specification, query)
    const scenarios = matchingScenarios(specification.scenarios, query)

    if (!matchesSpecification && scenarios.length === 0) return []

    return [
      {
        specification,
        scenarios: matchesSpecification ? specification.scenarios : scenarios,
      },
    ]
  })
}

function specificationMatches(
  specification: StudioSpecification,
  query: string,
): boolean {
  return (
    !query ||
    includesQuery(specification.name, query) ||
    includesQuery(specification.uri, query)
  )
}
