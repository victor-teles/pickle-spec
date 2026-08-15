import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin'
import { IdGenerator } from '@cucumber/messages'
import type {
  Background,
  Rule,
  Scenario as GherkinScenario,
  Step as GherkinStep,
} from '@cucumber/messages'

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

function mapSteps(steps: readonly GherkinStep[]): ScenarioStep[] {
  return steps.map(step => ({
    keyword: step.keyword.trim(),
    text: step.text,
  }))
}

function mapScenario(
  scenario: GherkinScenario,
  backgrounds: readonly Background[],
  inheritedTags: readonly string[] = [],
): Scenario {
  return {
    name: scenario.name,
    tags: [...inheritedTags, ...scenario.tags.map(({ name }) => name)],
    steps: [
      ...backgrounds.flatMap(background => mapSteps(background.steps)),
      ...mapSteps(scenario.steps),
    ],
  }
}

function mapRule(rule: Rule, featureBackgrounds: readonly Background[]): Scenario[] {
  const ruleBackgrounds = rule.children.flatMap(child => child.background ? [child.background] : [])
  const ruleTags = rule.tags.map(({ name }) => name)

  return rule.children.flatMap(child => child.scenario
    ? [mapScenario(child.scenario, [...featureBackgrounds, ...ruleBackgrounds], ruleTags)]
    : [])
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

  const featureBackgrounds = feature.children.flatMap(child => child.background ? [child.background] : [])
  const scenarios: Scenario[] = feature.children.flatMap((child) => {
    if (child.scenario) return [mapScenario(child.scenario, featureBackgrounds)]
    if (child.rule) return mapRule(child.rule, featureBackgrounds)
    return []
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
