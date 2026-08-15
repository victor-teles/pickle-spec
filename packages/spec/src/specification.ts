import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin'
import { IdGenerator } from '@cucumber/messages'

export interface SpecificationSource {
  uri: string
  language: string
}

export interface ScenarioStep {
  keyword: string
  text: string
}

export interface Scenario {
  name: string
  tags: string[]
  steps: ScenarioStep[]
}

export interface Specification {
  name: string
  source: SpecificationSource
  tags: string[]
  scenarios: Scenario[]
}

export interface ParseSpecificationInput {
  source: string
  uri: string
  language?: string
}

export function parseSpecification(input: ParseSpecificationInput): Specification {
  const language = input.language ?? 'en'
  const parser = new Parser(
    new AstBuilder(IdGenerator.incrementing()),
    new GherkinClassicTokenMatcher(language),
  )
  const document = parser.parse(input.source)
  const feature = document.feature

  if (!feature) {
    throw new Error(`Specification "${input.uri}" does not contain a Feature`)
  }

  const scenarios: Scenario[] = feature.children.flatMap(({ scenario }) => {
    if (!scenario) return []

    return [{
      name: scenario.name,
      tags: scenario.tags.map(({ name }) => name),
      steps: scenario.steps.map(step => ({
        keyword: step.keyword.trim(),
        text: step.text,
      })),
    }]
  })

  return {
    name: feature.name,
    source: {
      uri: input.uri,
      language: feature.language,
    },
    tags: feature.tags.map(({ name }) => name),
    scenarios,
  }
}

export async function parseSpecificationFile(filePath: string, language?: string): Promise<Specification> {
  return parseSpecification({
    source: await Bun.file(filePath).text(),
    uri: filePath,
    language,
  })
}
