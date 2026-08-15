import { AstBuilder, compile, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin'
import { IdGenerator, StepKeywordType } from '@cucumber/messages'
import type {
  GherkinDocument,
  PickleStep,
  Step,
} from '@cucumber/messages'

export interface SpecificationSource {
  uri: string
  language: string
}

export interface ScenarioStep {
  keyword: string
  text: string
  type: 'context' | 'action' | 'outcome'
  argument?: {
    dataTable?: string[][]
    docString?: string
  }
}

export interface Scenario {
  name: string
  tags: string[]
  steps: ScenarioStep[]
  capabilityRequirements?: string[]
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

type ScenarioStepType = ScenarioStep['type']

function stepType(keywordType: StepKeywordType | undefined, previous: ScenarioStepType): ScenarioStepType {
  switch (keywordType) {
    case StepKeywordType.CONTEXT:
      return 'context'
    case StepKeywordType.ACTION:
      return 'action'
    case StepKeywordType.OUTCOME:
      return 'outcome'
    case StepKeywordType.CONJUNCTION:
    case StepKeywordType.UNKNOWN:
    default:
      return previous
  }
}

function collectStepInfo(document: GherkinDocument): Map<string, Pick<ScenarioStep, 'keyword' | 'type'>> {
  const result = new Map<string, Pick<ScenarioStep, 'keyword' | 'type'>>()

  function addSteps(steps: readonly Step[]): void {
    let previous: ScenarioStepType = 'context'
    for (const step of steps) {
      previous = stepType(step.keywordType, previous)
      result.set(step.id, { keyword: step.keyword.trim(), type: previous })
    }
  }

  for (const child of document.feature?.children ?? []) {
    if (child.background) addSteps(child.background.steps)
    if (child.scenario) addSteps(child.scenario.steps)
    for (const ruleChild of child.rule?.children ?? []) {
      if (ruleChild.background) addSteps(ruleChild.background.steps)
      if (ruleChild.scenario) addSteps(ruleChild.scenario.steps)
    }
  }

  return result
}

function mapArgument(step: PickleStep): ScenarioStep['argument'] {
  if (step.argument?.dataTable) {
    return {
      dataTable: step.argument.dataTable.rows.map(row => row.cells.map(cell => cell.value)),
    }
  }
  if (step.argument?.docString) {
    return { docString: step.argument.docString.content }
  }
  return undefined
}

function mapStep(
  step: PickleStep,
  infoByAstNodeId: ReadonlyMap<string, Pick<ScenarioStep, 'keyword' | 'type'>>,
): ScenarioStep {
  const info = infoByAstNodeId.get(step.astNodeIds[0] ?? '')
  const argument = mapArgument(step)
  return {
    keyword: info?.keyword ?? '',
    text: step.text,
    type: info?.type ?? 'context',
    ...(argument ? { argument } : {}),
  }
}

export function parseSpecification(input: ParseSpecificationInput): Specification {
  const language = input.language ?? 'en'
  const newId = IdGenerator.incrementing()
  const parser = new Parser(
    new AstBuilder(newId),
    new GherkinClassicTokenMatcher(language),
  )
  const document = parser.parse(input.source)
  const feature = document.feature

  if (!feature) {
    throw new Error(`Specification "${input.uri}" does not contain a Feature`)
  }

  const infoByAstNodeId = collectStepInfo(document)
  const scenarios: Scenario[] = compile(document, input.uri, newId).map(pickle => ({
    name: pickle.name,
    tags: pickle.tags.map(({ name }) => name),
    steps: pickle.steps.map(step => mapStep(step, infoByAstNodeId)),
  }))

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
