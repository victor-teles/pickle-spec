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
  identityFromTags,
  resolveExamplesId,
  resolveExamplesRowId,
  resolveScenarioId,
  resolveSpecificationId,
  type SpecificationState,
} from '../identity/identity'

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

export interface ScenarioTemplate {
  name: string
  steps: ScenarioStep[]
  variableNames: string[]
}

export interface ScenarioVariableBinding {
  name: string
  value: string
}

export interface Scenario {
  name: string
  tags: string[]
  steps: ScenarioStep[]
  id?: string
  examplesId?: string
  examplesRowId?: string
  capabilityRequirements?: string[]
  template?: ScenarioTemplate
  runtimeBindings?: ScenarioVariableBinding[]
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

type OutlineRow = {
  header: string[]
  cells: string[]
  examplesTags: string[]
  examplesName: string
  scenarioName: string
}

const requiresTagPrefix = '@pickle:requires:'

type ScenarioStepType = ScenarioStep['type']

function capabilityRequirements(tags: readonly string[]): string[] | undefined {
  const required = [
    ...new Set(
      tags
        .filter((tag) => tag.startsWith(requiresTagPrefix))
        .map((tag) => tag.slice(requiresTagPrefix.length))
        .filter((value) => value.length > 0),
    ),
  ]
  return required.length > 0 ? required : undefined
}

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

function mapSourceArgument(step: Step): ScenarioStep['argument'] {
  if (step.dataTable) {
    return {
      dataTable: step.dataTable.rows.map((row) =>
        row.cells.map((cell) => cell.value),
      ),
    }
  }
  if (step.docString) return { docString: step.docString.content }
  return undefined
}

function collectStepInfo(document: GherkinDocument): Map<string, ScenarioStep> {
  const result = new Map<string, ScenarioStep>()

  function addSteps(steps: readonly Step[]): void {
    let previous: ScenarioStepType = 'context'
    for (const step of steps) {
      previous = stepType(step.keywordType, previous)
      const argument = mapSourceArgument(step)
      result.set(step.id, {
        keyword: step.keyword.trim(),
        text: step.text,
        type: previous,
        argument,
      })
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
  infoByAstNodeId: ReadonlyMap<string, ScenarioStep>,
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

function templateStep(
  step: PickleStep,
  infoByAstNodeId: ReadonlyMap<string, ScenarioStep>,
): ScenarioStep {
  return (
    infoByAstNodeId.get(step.astNodeIds[0] ?? '') ??
    mapStep(step, infoByAstNodeId)
  )
}

function templateVariableNames(
  name: string,
  steps: readonly ScenarioStep[],
  header: readonly string[],
): string[] {
  const referenced = new Set<string>()
  const collect = (value: string) => {
    for (const match of value.matchAll(/<([^>]+)>/g)) referenced.add(match[1]!)
  }
  collect(name)
  for (const step of steps) {
    collect(step.text)
    for (const row of step.argument?.dataTable ?? []) {
      for (const cell of row) collect(cell)
    }
    if (step.argument?.docString) collect(step.argument.docString)
  }
  return header.filter((variable) => referenced.has(variable))
}

function outlineVariables(row: OutlineRow): ScenarioVariableBinding[] {
  const runtimeBindings: ScenarioVariableBinding[] = []
  for (const [index, name] of row.header.entries()) {
    runtimeBindings.push({ name, value: row.cells[index] ?? '' })
  }
  return runtimeBindings
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
  const scenariosById = new Map<string, { tags: string[]; name: string }>()
  const rowsById = new Map<string, OutlineRow>()
  collectIdentityNodes(document, scenariosById, rowsById)
  const featureTags = feature.tags.map((tag) => tag.name)
  const featureIdentity = identityFromTags(featureTags)
  const scenarios: Scenario[] = compile(document, input.uri, newId).map(
    (pickle) => {
      const scenarioNode = scenariosById.get(pickle.astNodeIds[0] ?? '')
      const scenarioTags = scenarioNode?.tags ?? []
      const row = rowsById.get(pickle.astNodeIds[1] ?? '')
      const tags = pickle.tags.map(({ name }) => name)
      const requirements = capabilityRequirements(tags)
      const runtimeBindings = row ? outlineVariables(row) : undefined
      const templateSteps = row
        ? pickle.steps.map((step) => templateStep(step, infoByAstNodeId))
        : undefined
      const templateName = row ? (scenarioNode?.name ?? pickle.name) : undefined
      const template =
        row && templateName && templateSteps
          ? {
              name: templateName,
              steps: templateSteps,
              variableNames: templateVariableNames(
                templateName,
                templateSteps,
                row.header,
              ),
            }
          : undefined
      return {
        name: pickle.name,
        tags,
        steps: pickle.steps.map((step) => mapStep(step, infoByAstNodeId)),
        id: resolveScenarioId(
          input.uri,
          feature.name,
          scenarioNode?.name ?? pickle.name,
          scenarioTags,
        ),
        examplesId: row
          ? resolveExamplesId(
              input.uri,
              feature.name,
              row.scenarioName,
              row.examplesName,
              row.examplesTags,
            )
          : undefined,
        examplesRowId: row
          ? resolveExamplesRowId(
              input.uri,
              feature.name,
              row.scenarioName,
              row.examplesName,
              row.header,
              row.cells,
            )
          : undefined,
        template,
        runtimeBindings,
        capabilityRequirements: requirements,
      }
    },
  )

  return {
    name: feature.name,
    source: {
      uri: input.uri,
      language: feature.language,
    },
    tags: featureTags,
    scenarios,
    id: resolveSpecificationId(input.uri, feature.name, featureTags),
    ...(featureIdentity.state ? { state: featureIdentity.state } : {}),
  }
}

function collectIdentityNodes(
  document: GherkinDocument,
  scenariosById: Map<string, { tags: string[]; name: string }>,
  rowsById: Map<string, OutlineRow>,
): void {
  function visitExamples(scenarioName: string, examples: Examples): void {
    const header = examples.tableHeader?.cells.map((cell) => cell.value) ?? []
    const duplicate = header.find(
      (name, index) => header.indexOf(name) !== index,
    )
    if (duplicate) {
      throw new Error(
        `Scenario Outline Examples contain duplicate variable name "${duplicate}"`,
      )
    }
    const examplesTags = examples.tags.map((tag) => tag.name)
    for (const row of examples.tableBody) {
      rowsById.set(row.id, {
        header,
        cells: row.cells.map((cell) => cell.value),
        examplesTags,
        examplesName: examples.name,
        scenarioName,
      })
    }
  }

  function visitChild(child: FeatureChild | RuleChild): void {
    if (child.scenario) {
      scenariosById.set(child.scenario.id, {
        tags: child.scenario.tags.map((tag) => tag.name),
        name: child.scenario.name,
      })
      for (const examples of child.scenario.examples)
        visitExamples(child.scenario.name, examples)
    }
    if ('rule' in child && child.rule) {
      for (const ruleChild of child.rule.children) visitChild(ruleChild)
    }
  }

  for (const child of document.feature?.children ?? []) visitChild(child)
}
