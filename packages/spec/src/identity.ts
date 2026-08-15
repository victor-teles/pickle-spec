import {
  AstBuilder,
  GherkinClassicTokenMatcher,
  Parser,
} from '@cucumber/gherkin'
import type {
  Examples,
  Feature,
  FeatureChild,
  RuleChild,
  Scenario,
  TableRow,
} from '@cucumber/messages'
import { IdGenerator } from '@cucumber/messages'

export type SpecificationState = 'draft' | 'active' | 'deprecated'

export interface SpecificationSourceFile {
  uri: string
  source: string
}

export interface SpecificationMigrationChange {
  uri: string
  description: string
}

export interface SpecificationMigrationFile {
  uri: string
  source: string
  nextSource: string
}

export interface SpecificationMigrationPlan {
  changes: SpecificationMigrationChange[]
  files: SpecificationMigrationFile[]
}

const idTagPrefix = '@pickle:id:'
const stateTagPrefix = '@pickle:state:'
const rowIdColumn = 'pickle_id'
const validStates = ['draft', 'active', 'deprecated'] as const
const idPattern = /^[A-Za-z0-9_-]+$/

interface IdentityNode {
  kind: 'feature' | 'scenario' | 'examples' | 'examples-row'
  name?: string
  line: number
  column: number
  tags: string[]
  specificationName: string
  scenarioName?: string
  examplesName?: string
  rowValues?: string[]
  rowIndex?: number
  pickleIdValue?: string
}

type SourceEdit = { type: 'insert-line'; beforeLine: number; text: string }

function parseDocument(source: string, language = 'en') {
  return new Parser(
    new AstBuilder(IdGenerator.incrementing()),
    new GherkinClassicTokenMatcher(language),
  ).parse(source)
}

function idValues(tags: readonly string[]): string[] {
  return tags
    .filter((tag) => tag.startsWith(idTagPrefix))
    .map((tag) => tag.slice(idTagPrefix.length))
}

function stateValues(tags: readonly string[]): string[] {
  return tags
    .filter((tag) => tag.startsWith(stateTagPrefix))
    .map((tag) => tag.slice(stateTagPrefix.length))
}

function specificationState(
  value: string | undefined,
): SpecificationState | undefined {
  return validStates.find((state) => state === value)
}

export function identityFromTags(tags: readonly string[]): {
  id?: string
  state?: SpecificationState
} {
  const id = idValues(tags)[0]
  const state = specificationState(stateValues(tags)[0])
  return {
    ...(id ? { id } : {}),
    ...(state ? { state } : {}),
  }
}

export function examplesRowId(
  header: readonly string[],
  cells: readonly string[],
): string | undefined {
  const index = header.indexOf(rowIdColumn)
  const value = index >= 0 ? cells[index]?.trim() : undefined
  return value || undefined
}

function identifierDigest(parts: readonly string[]): string {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(parts.join('\0'))
  return hasher.digest('hex').slice(0, 16)
}

function explicitId(tags: readonly string[]): string | undefined {
  return idValues(tags)[0] || undefined
}

export function resolveSpecificationId(
  uri: string,
  name: string,
  tags: readonly string[],
): string {
  return explicitId(tags) ?? identifierDigest(['specification', uri, name])
}

export function resolveScenarioId(
  uri: string,
  specificationName: string,
  name: string,
  tags: readonly string[],
): string {
  return (
    explicitId(tags) ??
    identifierDigest(['scenario', uri, specificationName, name])
  )
}

export function resolveExamplesId(
  uri: string,
  specificationName: string,
  scenarioName: string,
  name: string,
  tags: readonly string[],
): string {
  return (
    explicitId(tags) ??
    identifierDigest(['examples', uri, specificationName, scenarioName, name])
  )
}

export function resolveExamplesRowId(
  uri: string,
  specificationName: string,
  scenarioName: string,
  examplesName: string,
  header: readonly string[],
  cells: readonly string[],
): string {
  const explicit = examplesRowId(header, cells)
  if (explicit) return explicit
  const values = cells.filter((_, index) => header[index] !== rowIdColumn)
  return identifierDigest([
    'examples-row',
    uri,
    specificationName,
    scenarioName,
    examplesName,
    ...values,
  ])
}

function nodeLabel(node: IdentityNode): string {
  switch (node.kind) {
    case 'feature':
      return node.name ? `Feature "${node.name}"` : 'Feature'
    case 'scenario':
      return `Scenario "${node.name}"`
    case 'examples':
      return node.name ? `Examples "${node.name}"` : 'Examples'
    case 'examples-row':
      return `Examples row ${node.rowIndex}`
  }
}

function sourcePosition(
  location: { line?: number; column?: number } | undefined,
): { line: number; column: number } {
  return { line: location?.line ?? 1, column: location?.column ?? 1 }
}

function visitScenario(
  scenario: Scenario,
  specificationName: string,
  nodes: IdentityNode[],
): void {
  nodes.push({
    kind: 'scenario',
    name: scenario.name,
    specificationName,
    scenarioName: scenario.name,
    ...sourcePosition(scenario.location),
    tags: scenario.tags.map((tag) => tag.name),
  })
  for (const examples of scenario.examples)
    collectExamples(examples, specificationName, scenario.name, nodes)
}

function collectExamples(
  examples: Examples,
  specificationName: string,
  scenarioName: string,
  nodes: IdentityNode[],
): void {
  const header = examples.tableHeader?.cells.map((cell) => cell.value) ?? []
  const pickleIdColumnIndex = header.indexOf(rowIdColumn)
  nodes.push({
    kind: 'examples',
    name: examples.name,
    specificationName,
    scenarioName,
    examplesName: examples.name,
    ...sourcePosition(examples.location),
    tags: examples.tags.map((tag) => tag.name),
  })
  for (const [index, row] of examples.tableBody.entries()) {
    collectExamplesRow(
      row,
      index,
      header,
      pickleIdColumnIndex,
      specificationName,
      scenarioName,
      examples.name,
      nodes,
    )
  }
}

function collectExamplesRow(
  row: TableRow,
  index: number,
  header: readonly string[],
  pickleIdColumnIndex: number,
  specificationName: string,
  scenarioName: string,
  examplesName: string,
  nodes: IdentityNode[],
): void {
  const cells = row.cells.map((cell) => cell.value)
  const value =
    pickleIdColumnIndex >= 0 ? (cells[pickleIdColumnIndex] ?? '') : ''
  nodes.push({
    kind: 'examples-row',
    specificationName,
    scenarioName,
    examplesName,
    rowValues: cells.filter(
      (_, cellIndex) => header[cellIndex] !== rowIdColumn,
    ),
    ...sourcePosition(row.location),
    tags: [],
    rowIndex: index + 1,
    pickleIdValue: value,
  })
}

function visitChild(
  child: FeatureChild | RuleChild,
  specificationName: string,
  nodes: IdentityNode[],
): void {
  if (child.scenario) visitScenario(child.scenario, specificationName, nodes)
  if ('rule' in child && child.rule) {
    for (const ruleChild of child.rule.children)
      visitChild(ruleChild, specificationName, nodes)
  }
}

function identityNodes(feature: Feature): IdentityNode[] {
  const nodes: IdentityNode[] = [
    {
      kind: 'feature',
      name: feature.name,
      specificationName: feature.name,
      ...sourcePosition(feature.location),
      tags: feature.tags.map((tag) => tag.name),
    },
  ]
  for (const child of feature.children) visitChild(child, feature.name, nodes)
  return nodes
}

function recordIdentifier(
  seen: Map<string, string>,
  id: string,
  uri: string,
  errors: string[],
): void {
  const existing = seen.get(id)
  if (existing) {
    errors.push(
      `Invalid Specification ${uri}: Duplicate identifier "${id}" also used in ${existing}. ` +
        'Give each Feature, Scenario, Examples block, and Examples row a unique identifier and run pickle check again.',
    )
    return
  }
  seen.set(id, uri)
}

function resolvedNodeId(node: IdentityNode, uri: string): string {
  if (node.kind === 'examples-row') {
    const explicit = node.pickleIdValue?.trim()
    if (explicit) return explicit
    return identifierDigest([
      'examples-row',
      uri,
      node.specificationName,
      node.scenarioName ?? '',
      node.examplesName ?? '',
      ...(node.rowValues ?? []),
    ])
  }
  if (node.kind === 'feature') {
    return resolveSpecificationId(uri, node.specificationName, node.tags)
  }
  if (node.kind === 'scenario') {
    return resolveScenarioId(
      uri,
      node.specificationName,
      node.scenarioName ?? '',
      node.tags,
    )
  }
  return resolveExamplesId(
    uri,
    node.specificationName,
    node.scenarioName ?? '',
    node.examplesName ?? '',
    node.tags,
  )
}

function validateNode(
  node: IdentityNode,
  uri: string,
  seen: Map<string, string>,
  errors: string[],
): void {
  if (node.kind === 'examples-row') {
    const explicit = node.pickleIdValue?.trim() ?? ''
    if (explicit && !idPattern.test(explicit)) {
      errors.push(
        `Invalid Specification ${uri}: Examples row ${node.rowIndex} has a malformed durable identifier "${explicit}". ` +
          'Use letters, numbers, underscores, or hyphens and run pickle check again.',
      )
      return
    }
    recordIdentifier(seen, resolvedNodeId(node, uri), uri, errors)
    return
  }

  const ids = idValues(node.tags)
  const states = stateValues(node.tags)
  if (node.kind === 'feature') {
    if (states.length > 1) {
      errors.push(
        `Invalid Specification ${uri}: Feature has conflicting Specification states ` +
          `${states.map((state) => `${stateTagPrefix}${state}`).join(' and ')}. ` +
          'Keep one of draft, active, or deprecated and run pickle check again.',
      )
    } else if (states.length === 1 && !specificationState(states[0])) {
      errors.push(
        `Invalid Specification ${uri}: Feature has a malformed Specification state "${states[0]}". ` +
          'Use draft, active, or deprecated and run pickle check again.',
      )
    } else if (states.length === 0) {
      errors.push(
        `Invalid Specification ${uri}: Feature is missing a Specification state. ` +
          'Run pickle migrate to add missing metadata.',
      )
    }
  } else if (states.length > 0) {
    errors.push(
      `Invalid Specification ${uri}: ${nodeLabel(node)} has a Specification state tag. ` +
        'Declare draft, active, or deprecated on the Feature and run pickle check again.',
    )
  }

  if (ids.length > 1) {
    errors.push(
      `Invalid Specification ${uri}: ${nodeLabel(node)} has conflicting durable identifiers. ` +
        'Keep one @pickle:id tag and run pickle check again.',
    )
    return
  }
  if (ids.length === 1 && (!ids[0] || !idPattern.test(ids[0]))) {
    errors.push(
      `Invalid Specification ${uri}: ${nodeLabel(node)} has a malformed durable identifier` +
        `${ids[0] ? ` "${ids[0]}"` : ''}. ` +
        'Use letters, numbers, underscores, or hyphens and run pickle check again.',
    )
    return
  }
  recordIdentifier(seen, resolvedNodeId(node, uri), uri, errors)
}

export function validateSpecificationMetadata(
  files: readonly SpecificationSourceFile[],
  language = 'en',
): void {
  const seen = new Map<string, string>()
  const errors: string[] = []
  for (const file of files) {
    const feature = parseDocument(file.source, language).feature
    if (!feature) {
      errors.push(
        `Invalid Specification ${file.uri}: Feature is missing. ` +
          'Correct the Specification and run pickle check again.',
      )
      continue
    }
    for (const node of identityNodes(feature))
      validateNode(node, file.uri, seen, errors)
  }
  if (errors.length > 0) throw new Error(errors.join('\n'))
}

function splitSource(source: string): { lines: string[]; newline: string } {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  return { lines: source.split(newline), newline }
}

function applyEdits(source: string, edits: readonly SourceEdit[]): string {
  const { lines, newline } = splitSource(source)
  const lineEdits = [...edits].sort(
    (left, right) => right.beforeLine - left.beforeLine,
  )
  for (const edit of lineEdits) {
    lines.splice(edit.beforeLine - 1, 0, edit.text)
  }
  return lines.join(newline)
}

function tagLine(column: number, tags: readonly string[]): string {
  return `${' '.repeat(Math.max(column - 1, 0))}${tags.join(' ')}`
}

function migrateFile(
  file: SpecificationSourceFile,
  feature: Feature | undefined,
): { nextSource: string; changes: SpecificationMigrationChange[] } {
  if (!feature) return { nextSource: file.source, changes: [] }

  const edits: SourceEdit[] = []
  const changes: SpecificationMigrationChange[] = []
  const nodes = identityNodes(feature)

  for (const node of nodes) {
    if (node.kind !== 'feature') continue
    if (stateValues(node.tags).length > 0) continue
    const tagsToAdd = [`${stateTagPrefix}active`]
    edits.push({
      type: 'insert-line',
      beforeLine: node.line,
      text: tagLine(node.column, tagsToAdd),
    })
    changes.push({
      uri: file.uri,
      description: `${nodeLabel(node)}: add ${tagsToAdd.join(' ')}`,
    })
  }

  return { nextSource: applyEdits(file.source, edits), changes }
}

export function planSpecificationMigration(
  files: readonly SpecificationSourceFile[],
  language = 'en',
): SpecificationMigrationPlan {
  const parsed = files.map((file) => ({
    file,
    feature: parseDocument(file.source, language).feature,
  }))
  const changes: SpecificationMigrationChange[] = []
  const nextFiles: SpecificationMigrationFile[] = []
  for (const { file, feature } of parsed) {
    const migrated = migrateFile(file, feature)
    changes.push(...migrated.changes)
    nextFiles.push({
      uri: file.uri,
      source: file.source,
      nextSource: migrated.nextSource,
    })
  }
  return { changes, files: nextFiles }
}

export function formatMigrationPreview(
  plan: SpecificationMigrationPlan,
): string {
  if (plan.changes.length === 0)
    return 'No Specification metadata changes needed'
  const uris = [...new Set(plan.changes.map((change) => change.uri))]
  const sections = uris.map((uri) => {
    const lines = plan.changes
      .filter((change) => change.uri === uri)
      .map((change) => `  ${change.description}`)
    return `${uri}\n${lines.join('\n')}`
  })
  return `Migration preview\n\n${sections.join('\n\n')}\n`
}
