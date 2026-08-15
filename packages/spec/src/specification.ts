import {
  AstBuilder,
  compile,
  GherkinClassicTokenMatcher,
  Parser,
} from '@cucumber/gherkin'
import type {
  Examples,
  FeatureChild,
  GherkinDocument,
  PickleStep,
  RuleChild,
  Step,
} from '@cucumber/messages'
import { IdGenerator, StepKeywordType } from '@cucumber/messages'
import {
  examplesRowId,
  identityFromTags,
  type SpecificationState,
} from './identity'

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
  id?: string
  examplesId?: string
  examplesRowId?: string
  capabilityRequirements?: string[]
}

export interface Specification {
  name: string
  source: SpecificationSource
  tags: string[]
  scenarios: Scenario[]
  id?: string
  state?: SpecificationState
}

export interface ParseSpecificationInput {
  source: string
  uri: string
  language?: string
}

type ScenarioStepType = ScenarioStep['type']

function stepType(
  keywordType: StepKeywordType | undefined,
  previous: ScenarioStepType,
): ScenarioStepType {
  switch (keywordType) {
    case StepKeywordType.CONTEXT:
      return 'context'
    case StepKeywordType.ACTION:
      return 'action'
    case StepKeywordType.OUTCOME:
      return 'outcome'
    default:
      return previous
  }
}

function collectStepInfo(
  document: GherkinDocument,
): Map<string, Pick<ScenarioStep, 'keyword' | 'type'>> {
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
      dataTable: step.argument.dataTable.rows.map((row) =>
        row.cells.map((cell) => cell.value),
      ),
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

export function parseSpecification(
  input: ParseSpecificationInput,
): Specification {
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
  const scenariosById = new Map<string, { tags: string[] }>()
  const rowsById = new Map<
    string,
    { header: string[]; cells: string[]; examplesTags: string[] }
  >()
  collectIdentityNodes(document, scenariosById, rowsById)
  const featureIdentity = identityFromTags(feature.tags.map((tag) => tag.name))
  const scenarios: Scenario[] = compile(document, input.uri, newId).map(
    (pickle) => {
      const scenarioIdentity = identityFromTags(
        scenariosById.get(pickle.astNodeIds[0] ?? '')?.tags ?? [],
      )
      const row = rowsById.get(pickle.astNodeIds[1] ?? '')
      const examplesIdentity = identityFromTags(row?.examplesTags ?? [])
      const rowId = row ? examplesRowId(row.header, row.cells) : undefined
      return {
        name: pickle.name,
        tags: pickle.tags.map(({ name }) => name),
        steps: pickle.steps.map((step) => mapStep(step, infoByAstNodeId)),
        ...(scenarioIdentity.id ? { id: scenarioIdentity.id } : {}),
        ...(examplesIdentity.id ? { examplesId: examplesIdentity.id } : {}),
        ...(rowId ? { examplesRowId: rowId } : {}),
      }
    },
  )

  return {
    name: feature.name,
    source: {
      uri: input.uri,
      language: feature.language,
    },
    tags: feature.tags.map(({ name }) => name),
    scenarios,
    ...(featureIdentity.id ? { id: featureIdentity.id } : {}),
    ...(featureIdentity.state ? { state: featureIdentity.state } : {}),
  }
}

function collectIdentityNodes(
  document: GherkinDocument,
  scenariosById: Map<string, { tags: string[] }>,
  rowsById: Map<
    string,
    { header: string[]; cells: string[]; examplesTags: string[] }
  >,
): void {
  function visitExamples(examples: Examples): void {
    const header = examples.tableHeader?.cells.map((cell) => cell.value) ?? []
    const examplesTags = examples.tags.map((tag) => tag.name)
    for (const row of examples.tableBody) {
      rowsById.set(row.id, {
        header,
        cells: row.cells.map((cell) => cell.value),
        examplesTags,
      })
    }
  }

  function visitChild(child: FeatureChild | RuleChild): void {
    if (child.scenario) {
      scenariosById.set(child.scenario.id, {
        tags: child.scenario.tags.map((tag) => tag.name),
      })
      for (const examples of child.scenario.examples) visitExamples(examples)
    }
    if ('rule' in child && child.rule) {
      for (const ruleChild of child.rule.children) visitChild(ruleChild)
    }
  }

  for (const child of document.feature?.children ?? []) visitChild(child)
}

export async function parseSpecificationFile(
  filePath: string,
  language?: string,
): Promise<Specification> {
  return parseSpecification({
    source: await Bun.file(filePath).text(),
    uri: filePath,
    language,
  })
}
