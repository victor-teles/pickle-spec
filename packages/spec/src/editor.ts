import {
  AstBuilder,
  GherkinClassicTokenMatcher,
  Parser,
} from '@cucumber/gherkin'
import type {
  Examples,
  Feature,
  FeatureChild,
  GherkinDocument,
  RuleChild,
  Scenario,
  Step,
} from '@cucumber/messages'
import { IdGenerator } from '@cucumber/messages'
import type { SpecificationState } from './identity'
import type { ParseSpecificationInput } from './specification'

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

function parseDocument(source: string, language: string): GherkinDocument {
  return new Parser(
    new AstBuilder(IdGenerator.incrementing()),
    new GherkinClassicTokenMatcher(language),
  ).parse(source)
}

function tagNames(tags: readonly { name: string }[] | undefined): string[] {
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

function mapChild(
  child: FeatureChild | RuleChild,
): StructuredBackground | StructuredScenario | StructuredRule | undefined {
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
  if ('rule' in child && child.rule) {
    return {
      kind: 'rule',
      name: child.rule.name,
      tags: tagNames(child.rule.tags),
      children: child.rule.children
        .map((ruleChild) => mapChild(ruleChild))
        .filter((value) => value && value.kind !== 'rule') as Array<
        StructuredBackground | StructuredScenario
      >,
    }
  }
}

export interface ExternalLink {
  namespace: string
  id: string
}

export interface SpecificationMetadata {
  state?: SpecificationState
  tags?: readonly string[]
  links?: readonly ExternalLink[]
}

export interface ApplyStructuredSpecificationInput {
  uri: string
  source: string
  language?: string
  specification: StructuredSpecification
}

type SourceLocation = { line?: number; column?: number }

type Replacement = { start: number; end: number; text: string }

function splitSource(source: string): { lines: string[]; newline: string } {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  return { lines: source.split(newline), newline }
}

function newlineFor(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n'
}

function offsetAt(source: string, location: SourceLocation): number {
  const { lines, newline } = splitSource(source)
  const line = Math.max(location.line ?? 1, 1)
  let offset = 0
  for (let index = 0; index < line - 1; index++) {
    offset += (lines[index]?.length ?? 0) + newline.length
  }
  return offset + Math.max((location.column ?? 1) - 1, 0)
}

function applyReplacements(
  source: string,
  replacements: readonly Replacement[],
): string {
  const ordered = [...replacements].sort(
    (left, right) => right.start - left.start,
  )
  let next = source
  for (const replacement of ordered) {
    next =
      next.slice(0, replacement.start) +
      replacement.text +
      next.slice(replacement.end)
  }
  return next
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function nameReplacement(
  source: string,
  location: SourceLocation | undefined,
  keyword: string,
  currentName: string,
  nextName: string,
): Replacement | undefined {
  if (!location?.line || currentName === nextName) return undefined
  const start = offsetAt(source, location)
  const rest = source.slice(start)
  const match = rest.match(new RegExp(`^${escapeRegex(keyword)}\\s*:\\s*`))
  if (!match) return undefined
  const nameStart = start + match[0].length
  return {
    start: nameStart,
    end: nameStart + currentName.length,
    text: nextName,
  }
}

function tagReplacement(
  source: string,
  tags: readonly { name: string; location?: SourceLocation }[],
  nextTags: readonly string[],
  keywordLocation: SourceLocation | undefined,
): Replacement | undefined {
  const current = tags.map((tag) => tag.name)
  if (sameValues(current, nextTags)) return undefined
  if (tags[0]?.location?.line && tags[tags.length - 1]?.location?.column) {
    const first = tags[0]!
    const last = tags[tags.length - 1]!
    const start = offsetAt(source, first.location!)
    const end = offsetAt(source, last.location!) + last.name.length
    return { start, end, text: nextTags.join(' ') }
  }
  if (nextTags.length === 0 || !keywordLocation?.line) return undefined
  const indent = Math.max((keywordLocation.column ?? 1) - 1, 0)
  const lineStart = offsetAt(source, { line: keywordLocation.line, column: 1 })
  return {
    start: lineStart,
    end: lineStart,
    text: `${' '.repeat(indent)}${nextTags.join(' ')}${newlineFor(source)}`,
  }
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

export function specificationSourceDiff(from: string, to: string): string {
  if (from === to) return ''
  const fromLines = splitSource(from).lines
  const toLines = splitSource(to).lines
  const lines: string[] = ['--- current', '+++ proposed']
  let fromIndex = 0
  let toIndex = 0
  const matrix = longestCommonSubsequence(fromLines, toLines)
  while (fromIndex < fromLines.length && toIndex < toLines.length) {
    if (fromLines[fromIndex] === toLines[toIndex]) {
      fromIndex++
      toIndex++
      continue
    }
    if (
      (matrix[fromIndex + 1]?.[toIndex] ?? 0) >=
      (matrix[fromIndex]?.[toIndex + 1] ?? 0)
    ) {
      lines.push(`-${fromLines[fromIndex]!}`)
      fromIndex++
    } else {
      lines.push(`+${toLines[toIndex]!}`)
      toIndex++
    }
  }
  while (fromIndex < fromLines.length) {
    lines.push(`-${fromLines[fromIndex++]!}`)
  }
  while (toIndex < toLines.length) {
    lines.push(`+${toLines[toIndex++]!}`)
  }
  return `${lines.join('\n')}\n`
}

function longestCommonSubsequence(
  fromLines: readonly string[],
  toLines: readonly string[],
): number[][] {
  const matrix = Array.from({ length: fromLines.length + 1 }, () =>
    Array.from({ length: toLines.length + 1 }, () => 0),
  )
  for (let fromIndex = fromLines.length - 1; fromIndex >= 0; fromIndex--) {
    for (let toIndex = toLines.length - 1; toIndex >= 0; toIndex--) {
      matrix[fromIndex]![toIndex] =
        fromLines[fromIndex] === toLines[toIndex]
          ? (matrix[fromIndex + 1]![toIndex + 1] ?? 0) + 1
          : Math.max(
              matrix[fromIndex + 1]![toIndex] ?? 0,
              matrix[fromIndex]![toIndex + 1] ?? 0,
            )
    }
  }
  return matrix
}

const stateTagPrefix = '@pickle:state:'
const idTagPrefix = '@pickle:id:'
const requiresTagPrefix = '@pickle:requires:'

function normalizedTag(tag: string): string {
  const value = tag.trim()
  return value.startsWith('@') ? value : `@${value}`
}

function linkTagPrefix(namespace: string): string {
  return `@${namespace}:`
}

function isLinkTag(tag: string, namespaces: readonly string[]): boolean {
  return namespaces.some(
    (namespace) =>
      namespace.length > 0 && tag.startsWith(linkTagPrefix(namespace)),
  )
}

export function parseExternalLinks(
  tags: readonly string[],
  namespaces: readonly string[],
): ExternalLink[] {
  const links: ExternalLink[] = []
  for (const tag of tags) {
    for (const namespace of namespaces) {
      const prefix = linkTagPrefix(namespace)
      if (!tag.startsWith(prefix)) continue
      const id = tag.slice(prefix.length)
      if (id) links.push({ namespace, id })
    }
  }
  return links
}

export function authorTags(
  tags: readonly string[],
  namespaces: readonly string[] = [],
): string[] {
  return tags.filter(
    (tag) => !tag.startsWith('@pickle:') && !isLinkTag(tag, namespaces),
  )
}

function nextFeatureTags(
  current: readonly string[],
  metadata: SpecificationMetadata,
): string[] {
  const linkNamespaces = [
    ...new Set((metadata.links ?? []).map((link) => link.namespace)),
  ]
  const identity = current.filter((tag) => tag.startsWith(idTagPrefix))
  const requires = current.filter((tag) => tag.startsWith(requiresTagPrefix))
  const state = metadata.state
    ? [`${stateTagPrefix}${metadata.state}`]
    : current.filter((tag) => tag.startsWith(stateTagPrefix))
  const links = metadata.links
    ? metadata.links
        .filter((link) => link.namespace.trim() && link.id.trim())
        .map(
          (link) => `${linkTagPrefix(link.namespace.trim())}${link.id.trim()}`,
        )
    : parseExternalLinks(current, linkNamespaces).map(
        (link) => `${linkTagPrefix(link.namespace)}${link.id}`,
      )
  const authors = metadata.tags
    ? authorTags(
        metadata.tags.map(normalizedTag).filter((tag) => tag.length > 1),
        linkNamespaces,
      )
    : authorTags(current, linkNamespaces)
  return [...identity, ...state, ...authors, ...links, ...requires]
}

export function applySpecificationMetadata(
  source: string,
  metadata: SpecificationMetadata,
  language = 'en',
): string {
  const document = parseDocument(source, language)
  const feature = document.feature
  if (!feature) {
    throw new Error('Specification does not contain a Feature')
  }
  const replacement = tagReplacement(
    source,
    feature.tags,
    nextFeatureTags(tagNames(feature.tags), metadata),
    feature.location,
  )
  return replacement ? applyReplacements(source, [replacement]) : source
}

export function ensureSpecificationState(
  source: string,
  state: SpecificationState,
  language = 'en',
): string {
  const document = parseDocument(source, language)
  const feature = document.feature
  if (!feature) {
    throw new Error('Specification does not contain a Feature')
  }
  const current = feature.tags.find((tag) =>
    tag.name.startsWith(stateTagPrefix),
  )
  const nextTag = `${stateTagPrefix}${state}`
  if (current?.name === nextTag) return source
  if (current) {
    const start = offsetAt(source, current.location)
    return applyReplacements(source, [
      { start, end: start + current.name.length, text: nextTag },
    ])
  }
  const replacement = tagReplacement(
    source,
    feature.tags,
    [...tagNames(feature.tags), nextTag],
    feature.location,
  )
  return replacement ? applyReplacements(source, [replacement]) : source
}

export function readSpecificationDocument(
  input: ParseSpecificationInput,
): SpecificationDocument {
  const language = input.language ?? 'en'
  const document = parseDocument(input.source, language)
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
      children: feature.children
        .map((child) => mapChild(child))
        .filter((child): child is StructuredChild => child !== undefined),
    },
  }
}
