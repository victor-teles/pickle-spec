import type {
  Examples,
  Feature,
  FeatureChild,
  RuleChild,
  Scenario,
  Step,
} from '@cucumber/messages'
import type { ParseSpecificationInput } from '../parsing/specification'
import {
  parseGherkinDocument as parseDocument,
  readSpecificationDocument,
  type StructuredChild,
  type StructuredExamples,
  type StructuredScenario,
  type StructuredSpecification,
  type StructuredStep,
} from './specification-document'

export { specificationSourceDiff } from './source-diff'
export type {
  SpecificationDocument,
  StructuredBackground,
  StructuredChild,
  StructuredExamples,
  StructuredRule,
  StructuredScenario,
  StructuredSpecification,
  StructuredStep,
} from './specification-document'
export { readSpecificationDocument } from './specification-document'
export type {
  ExternalLink,
  SpecificationMetadata,
} from './specification-metadata'
export {
  applySpecificationMetadata,
  authorTags,
  ensureSpecificationState,
  parseExternalLinks,
} from './specification-metadata'

import {
  applyReplacements,
  nameReplacement,
  newlineFor,
  offsetAt,
  type Replacement,
  type SourceLocation,
  tagReplacement,
} from './source-operations'

export interface ApplyStructuredSpecificationInput {
  uri: string
  source: string
  language?: string
  specification: StructuredSpecification
}

function stepEndLine(step: Step): number {
  const rows = step.dataTable?.rows
  if (rows && rows.length > 0) {
    return rows[rows.length - 1]?.location.line ?? step.location.line
  }
  if (step.docString) {
    const contentLines = step.docString.content.split('\n').length
    return step.docString.location.line + contentLines + 1
  }
  return step.location.line
}

function stepReplacements(
  source: string,
  steps: readonly Step[],
  nextSteps: readonly StructuredStep[],
  fallbackLocation: SourceLocation | undefined,
): Replacement[] {
  const replacements: Replacement[] = []
  const shared = Math.min(steps.length, nextSteps.length)
  for (let index = 0; index < shared; index++) {
    const step = steps[index]!
    const next = nextSteps[index]!
    if (step.keyword.trim() !== next.keyword) {
      const start = offsetAt(source, step.location)
      replacements.push({
        start,
        end: start + step.keyword.length,
        text: step.keyword.endsWith(' ') ? `${next.keyword} ` : next.keyword,
      })
    }
    if (step.text !== next.text) {
      const start = offsetAt(source, step.location) + step.keyword.length
      replacements.push({
        start,
        end: start + step.text.length,
        text: next.text,
      })
    }
  }
  if (nextSteps.length > steps.length) {
    const last = steps[steps.length - 1]
    const indent = Math.max(
      (last?.location.column ?? fallbackLocation?.column ?? 5) - 1,
      0,
    )
    const afterLine = last ? stepEndLine(last) : (fallbackLocation?.line ?? 1)
    const insertAt = offsetAt(source, { line: afterLine + 1, column: 1 })
    const newline = newlineFor(source)
    const added = nextSteps
      .slice(steps.length)
      .map((step) => `${' '.repeat(indent)}${step.keyword} ${step.text}`)
      .join(newline)
    replacements.push({
      start: insertAt,
      end: insertAt,
      text: `${added}${newline}`,
    })
  }
  if (steps.length > nextSteps.length) {
    for (let index = steps.length - 1; index >= nextSteps.length; index--) {
      const step = steps[index]!
      const start = offsetAt(source, { line: step.location.line, column: 1 })
      const end = offsetAt(source, { line: stepEndLine(step) + 1, column: 1 })
      replacements.push({ start, end, text: '' })
    }
  }
  return replacements
}

function cellReplacements(
  source: string,
  cells: readonly { value: string; location: SourceLocation }[],
  nextValues: readonly string[],
): Replacement[] {
  const shared = Math.min(cells.length, nextValues.length)
  const replacements: Replacement[] = []
  for (let index = 0; index < shared; index++) {
    const cell = cells[index]!
    const nextValue = nextValues[index]!
    if (cell.value === nextValue) continue
    const start = offsetAt(source, cell.location)
    replacements.push({
      start,
      end: start + cell.value.length,
      text: nextValue,
    })
  }
  return replacements
}

function examplesReplacements(
  source: string,
  examples: Examples,
  next: StructuredExamples,
): Replacement[] {
  const replacements: Array<Replacement | undefined> = [
    nameReplacement(
      source,
      examples.location,
      examples.keyword.trim(),
      examples.name,
      next.name,
    ),
    tagReplacement(source, examples.tags, next.tags, examples.location),
  ]
  if (examples.tableHeader) {
    replacements.push(
      ...cellReplacements(source, examples.tableHeader.cells, next.header),
    )
  }
  const body = examples.tableBody
  const shared = Math.min(body.length, next.rows.length)
  for (let index = 0; index < shared; index++) {
    replacements.push(
      ...cellReplacements(source, body[index]!.cells, next.rows[index]!),
    )
  }
  if (next.rows.length > body.length) {
    const last = body[body.length - 1] ?? examples.tableHeader
    const indent = Math.max((last?.location.column ?? 1) - 1, 0)
    const afterLine = last?.location.line ?? examples.location.line
    const insertAt = offsetAt(source, { line: afterLine + 1, column: 1 })
    const newline = newlineFor(source)
    const added = next.rows
      .slice(body.length)
      .map((row) => `${' '.repeat(indent)}| ${row.join(' | ')} |`)
      .join(newline)
    replacements.push({
      start: insertAt,
      end: insertAt,
      text: `${added}${newline}`,
    })
  }
  if (body.length > next.rows.length) {
    for (let index = body.length - 1; index >= next.rows.length; index--) {
      const row = body[index]!
      const start = offsetAt(source, { line: row.location.line, column: 1 })
      const end = offsetAt(source, { line: row.location.line + 1, column: 1 })
      replacements.push({ start, end, text: '' })
    }
  }
  return replacements.filter(
    (replacement): replacement is Replacement => replacement !== undefined,
  )
}

function scenarioReplacements(
  source: string,
  scenario: Scenario,
  next: StructuredScenario,
): Replacement[] {
  return [
    nameReplacement(
      source,
      scenario.location,
      scenario.keyword.trim(),
      scenario.name,
      next.name,
    ),
    tagReplacement(source, scenario.tags, next.tags, scenario.location),
    ...stepReplacements(source, scenario.steps, next.steps, scenario.location),
    ...scenario.examples.flatMap((examples, index) => {
      const nextExamples = next.examples[index]
      return nextExamples
        ? examplesReplacements(source, examples, nextExamples)
        : []
    }),
  ].filter(
    (replacement): replacement is Replacement => replacement !== undefined,
  )
}

function childReplacements(
  source: string,
  child: FeatureChild | RuleChild,
  next: StructuredChild,
): Replacement[] {
  if (child.scenario) {
    if (next.kind !== 'scenario') {
      throw new Error(
        'Structured Specification children no longer match the source document',
      )
    }
    return scenarioReplacements(source, child.scenario, next)
  }
  if ('rule' in child && child.rule) {
    if (next.kind !== 'rule') {
      throw new Error(
        'Structured Specification children no longer match the source document',
      )
    }
    return [
      nameReplacement(
        source,
        child.rule.location,
        child.rule.keyword.trim(),
        child.rule.name,
        next.name,
      ),
      tagReplacement(source, child.rule.tags, next.tags, child.rule.location),
      ...walkChildren(source, child.rule.children, next.children),
    ].filter(
      (replacement): replacement is Replacement => replacement !== undefined,
    )
  }
  if (child.background && next.kind === 'background') {
    return [
      nameReplacement(
        source,
        child.background.location,
        child.background.keyword.trim(),
        child.background.name,
        next.name,
      ),
      ...stepReplacements(
        source,
        child.background.steps,
        next.steps,
        child.background.location,
      ),
    ].filter(
      (replacement): replacement is Replacement => replacement !== undefined,
    )
  }
  throw new Error(
    'Structured Specification children no longer match the source document',
  )
}

function walkChildren(
  source: string,
  children: readonly FeatureChild[] | readonly RuleChild[],
  nextChildren: readonly StructuredChild[],
): Replacement[] {
  const count = Math.min(children.length, nextChildren.length)
  const replacements: Replacement[] = []
  for (let index = 0; index < count; index++) {
    replacements.push(
      ...childReplacements(source, children[index]!, nextChildren[index]!),
    )
  }
  return replacements
}

function featureReplacements(
  source: string,
  feature: Feature,
  next: StructuredSpecification,
): Replacement[] {
  return [
    nameReplacement(
      source,
      feature.location,
      feature.keyword.trim(),
      feature.name,
      next.name,
    ),
    tagReplacement(source, feature.tags, next.tags, feature.location),
    ...walkChildren(source, feature.children, next.children),
  ].filter(
    (replacement): replacement is Replacement => replacement !== undefined,
  )
}

export function applyStructuredSpecification(
  input: ApplyStructuredSpecificationInput,
): string {
  const language = input.language ?? 'en'
  const document = parseDocument(input.source, language)
  const feature = document.feature
  if (!feature) {
    throw new Error(`Specification "${input.uri}" does not contain a Feature`)
  }
  return applyReplacements(
    input.source,
    featureReplacements(input.source, feature, input.specification),
  )
}

export function applySpecificationSource(
  input: ParseSpecificationInput,
): string {
  readSpecificationDocument(input)
  return input.source
}
