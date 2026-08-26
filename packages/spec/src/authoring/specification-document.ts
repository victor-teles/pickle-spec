import {
  AstBuilder,
  GherkinClassicTokenMatcher,
  Parser,
} from '@cucumber/gherkin'
import type {
  Examples,
  FeatureChild,
  GherkinDocument,
  RuleChild,
  Step,
} from '@cucumber/messages'
import { IdGenerator } from '@cucumber/messages'
import type { ParseSpecificationInput } from '../parsing/specification'

export interface StructuredStep {
  keyword: string
  text: string
  argument?: {
    dataTable?: string[][]
    docString?: string
  }
}

export interface StructuredExamples {
  name: string
  tags: string[]
  header: string[]
  rows: string[][]
}

export interface StructuredScenario {
  kind: 'scenario'
  keyword: string
  name: string
  tags: string[]
  steps: StructuredStep[]
  examples: StructuredExamples[]
}

export interface StructuredBackground {
  kind: 'background'
  name: string
  steps: StructuredStep[]
}

export interface StructuredRule {
  kind: 'rule'
  name: string
  tags: string[]
  children: Array<StructuredBackground | StructuredScenario>
}

export type StructuredChild =
  | StructuredBackground
  | StructuredScenario
  | StructuredRule

export interface StructuredSpecification {
  name: string
  tags: string[]
  children: StructuredChild[]
}

export interface SpecificationDocument {
  uri: string
  source: string
  language: string
  specification: StructuredSpecification
}

export function parseGherkinDocument(
  source: string,
  language: string,
): GherkinDocument {
  return new Parser(
    new AstBuilder(IdGenerator.incrementing()),
    new GherkinClassicTokenMatcher(language),
  ).parse(source)
}

export function tagNames(
  tags: readonly { name: string }[] | undefined,
): string[] {
  return tags?.map((tag) => tag.name) ?? []
}

function mapStep(step: Step): StructuredStep {
  const mapped: StructuredStep = {
    keyword: step.keyword.trim(),
    text: step.text,
  }
  if (step.dataTable) {
    mapped.argument = {
      dataTable: step.dataTable.rows.map((row) =>
        row.cells.map((cell) => cell.value),
      ),
    }
  } else if (step.docString) {
    mapped.argument = { docString: step.docString.content }
  }
  return mapped
}

function mapExamples(examples: Examples): StructuredExamples {
  return {
    name: examples.name,
    tags: tagNames(examples.tags),
    header: examples.tableHeader?.cells.map((cell) => cell.value) ?? [],
    rows: examples.tableBody.map((row) => row.cells.map((cell) => cell.value)),
  }
}

function mapRuleChildren(
  children: readonly RuleChild[],
): Array<StructuredBackground | StructuredScenario> {
  return children.flatMap((child) => {
    const mapped = mapChild(child)
    return mapped && mapped.kind !== 'rule' ? [mapped] : []
  })
}

function mapChild(
  child: FeatureChild | RuleChild,
): StructuredChild | undefined {
  if (child.background) {
    return {
      kind: 'background',
      name: child.background.name,
      steps: child.background.steps.map(mapStep),
    }
  }
  if (child.scenario) {
    return {
      kind: 'scenario',
      keyword: child.scenario.keyword.trim(),
      name: child.scenario.name,
      tags: tagNames(child.scenario.tags),
      steps: child.scenario.steps.map(mapStep),
      examples: child.scenario.examples.map(mapExamples),
    }
  }
  if (!('rule' in child) || !child.rule) return undefined
  return {
    kind: 'rule',
    name: child.rule.name,
    tags: tagNames(child.rule.tags),
    children: mapRuleChildren(child.rule.children),
  }
}

export function readSpecificationDocument(
  input: ParseSpecificationInput,
): SpecificationDocument {
  const language = input.language ?? 'en'
  const document = parseGherkinDocument(input.source, language)
  const feature = document.feature
  if (!feature) {
    throw new Error(`Specification "${input.uri}" does not contain a Feature`)
  }
  return {
    uri: input.uri,
    source: input.source,
    language: feature.language || language,
    specification: {
      name: feature.name,
      tags: tagNames(feature.tags),
      children: feature.children.flatMap((child) => {
        const mapped = mapChild(child)
        return mapped ? [mapped] : []
      }),
    },
  }
}
