import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin'
import { IdGenerator } from '@cucumber/messages'
import type {
  Examples,
  Feature,
  FeatureChild,
  RuleChild,
  Scenario,
  TableRow,
} from '@cucumber/messages'

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

const ID_TAG_PREFIX = '@pickle:id:'
const STATE_TAG_PREFIX = '@pickle:state:'
const ROW_ID_COLUMN = 'pickle_id'
const VALID_STATES = ['draft', 'active', 'deprecated'] as const
const ID_PATTERN = /^[A-Za-z0-9_-]+$/

interface IdentityNode {
  kind: 'feature' | 'scenario' | 'examples' | 'examples-row'
  name?: string
  line: number
  column: number
  tags: string[]
  rowIndex?: number
  pickleIdValue?: string
  pickleIdColumnIndex?: number
  headerLine?: number
}

type SourceEdit =
  | { type: 'insert-line'; beforeLine: number; text: string }
  | { type: 'insert-column'; line: number; value: string }
  | { type: 'fill-cell'; line: number; columnIndex: number; value: string }

function parseDocument(source: string, language = 'en') {
  return new Parser(
    new AstBuilder(IdGenerator.incrementing()),
    new GherkinClassicTokenMatcher(language),
  ).parse(source)
}

function idValues(tags: readonly string[]): string[] {
  return tags.filter(tag => tag.startsWith(ID_TAG_PREFIX)).map(tag => tag.slice(ID_TAG_PREFIX.length))
}

function stateValues(tags: readonly string[]): string[] {
  return tags.filter(tag => tag.startsWith(STATE_TAG_PREFIX)).map(tag => tag.slice(STATE_TAG_PREFIX.length))
}

function specificationState(value: string | undefined): SpecificationState | undefined {
  return VALID_STATES.find(state => state === value)
}

export function identityFromTags(tags: readonly string[]): { id?: string; state?: SpecificationState } {
  const id = idValues(tags)[0]
  const state = specificationState(stateValues(tags)[0])
  return {
    ...(id ? { id } : {}),
    ...(state ? { state } : {}),
  }
}

export function examplesRowId(header: readonly string[], cells: readonly string[]): string | undefined {
  const index = header.indexOf(ROW_ID_COLUMN)
  const value = index >= 0 ? cells[index]?.trim() : undefined
  return value || undefined
}

function nodeLabel(node: IdentityNode): string {
  switch (node.kind) {
    case 'feature': return node.name ? `Feature "${node.name}"` : 'Feature'
    case 'scenario': return `Scenario "${node.name}"`
    case 'examples': return node.name ? `Examples "${node.name}"` : 'Examples'
    case 'examples-row': return `Examples row ${node.rowIndex}`
  }
}

function sourcePosition(location: { line?: number; column?: number } | undefined): { line: number; column: number } {
  return { line: location?.line ?? 1, column: location?.column ?? 1 }
}

function visitScenario(scenario: Scenario, nodes: IdentityNode[]): void {
  nodes.push({
    kind: 'scenario',
    name: scenario.name,
    ...sourcePosition(scenario.location),
    tags: scenario.tags.map(tag => tag.name),
  })
  for (const examples of scenario.examples) collectExamples(examples, nodes)
}

function collectExamples(examples: Examples, nodes: IdentityNode[]): void {
  const header = examples.tableHeader?.cells.map(cell => cell.value) ?? []
  const pickleIdColumnIndex = header.indexOf(ROW_ID_COLUMN)
  nodes.push({
    kind: 'examples',
    name: examples.name,
    ...sourcePosition(examples.location),
    tags: examples.tags.map(tag => tag.name),
    headerLine: examples.tableHeader?.location.line,
    pickleIdColumnIndex: pickleIdColumnIndex >= 0 ? pickleIdColumnIndex : undefined,
  })
  examples.tableBody.forEach((row, index) => collectExamplesRow(row, index, pickleIdColumnIndex, nodes))
}

function collectExamplesRow(
  row: TableRow,
  index: number,
  pickleIdColumnIndex: number,
  nodes: IdentityNode[],
): void {
  const value = pickleIdColumnIndex >= 0 ? row.cells[pickleIdColumnIndex]?.value ?? '' : ''
  nodes.push({
    kind: 'examples-row',
    ...sourcePosition(row.location),
    tags: [],
    rowIndex: index + 1,
    pickleIdValue: value,
    pickleIdColumnIndex: pickleIdColumnIndex >= 0 ? pickleIdColumnIndex : undefined,
  })
}

function visitChild(child: FeatureChild | RuleChild, nodes: IdentityNode[]): void {
  if (child.scenario) visitScenario(child.scenario, nodes)
  if ('rule' in child && child.rule) {
    for (const ruleChild of child.rule.children) visitChild(ruleChild, nodes)
  }
}

function identityNodes(feature: Feature): IdentityNode[] {
  const nodes: IdentityNode[] = [{
    kind: 'feature',
    name: feature.name,
    ...sourcePosition(feature.location),
    tags: feature.tags.map(tag => tag.name),
  }]
  for (const child of feature.children) visitChild(child, nodes)
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
      `Invalid Specification ${uri}: Duplicate identifier "${id}" also used in ${existing}. `
      + 'Give each Feature, Scenario, Examples block, and Examples row a unique identifier and run pickle check again.',
    )
    return
  }
  seen.set(id, uri)
}

function validateNode(node: IdentityNode, uri: string, seen: Map<string, string>, errors: string[]): void {
  if (node.kind === 'examples-row') {
    const id = node.pickleIdValue?.trim() ?? ''
    if (!id) {
      errors.push(
        `Invalid Specification ${uri}: Examples row ${node.rowIndex} is missing a pickle_id. `
        + 'Run pickle migrate to add missing metadata.',
      )
      return
    }
    if (!ID_PATTERN.test(id)) {
      errors.push(
        `Invalid Specification ${uri}: Examples row ${node.rowIndex} has a malformed durable identifier "${id}". `
        + 'Use letters, numbers, underscores, or hyphens and run pickle check again.',
      )
      return
    }
    recordIdentifier(seen, id, uri, errors)
    return
  }

  const ids = idValues(node.tags)
  const states = stateValues(node.tags)
  if (node.kind === 'feature') {
    if (states.length > 1) {
      errors.push(
        `Invalid Specification ${uri}: Feature has conflicting Specification states `
        + `${states.map(state => `${STATE_TAG_PREFIX}${state}`).join(' and ')}. `
        + 'Keep one of draft, active, or deprecated and run pickle check again.',
      )
    } else if (states.length === 1 && !specificationState(states[0])) {
      errors.push(
        `Invalid Specification ${uri}: Feature has a malformed Specification state "${states[0]}". `
        + 'Use draft, active, or deprecated and run pickle check again.',
      )
    } else if (states.length === 0) {
      errors.push(
        `Invalid Specification ${uri}: Feature is missing a Specification state. `
        + 'Run pickle migrate to add missing metadata.',
      )
    }
  } else if (states.length > 0) {
    errors.push(
      `Invalid Specification ${uri}: ${nodeLabel(node)} has a Specification state tag. `
      + 'Declare draft, active, or deprecated on the Feature and run pickle check again.',
    )
  }

  if (ids.length > 1) {
    errors.push(
      `Invalid Specification ${uri}: ${nodeLabel(node)} has conflicting durable identifiers. `
      + 'Keep one @pickle:id tag and run pickle check again.',
    )
    return
  }
  if (ids.length === 0) {
    errors.push(
      `Invalid Specification ${uri}: ${nodeLabel(node)} is missing a durable identifier. `
      + 'Run pickle migrate to add missing metadata.',
    )
    return
  }
  if (!ids[0] || !ID_PATTERN.test(ids[0])) {
    errors.push(
      `Invalid Specification ${uri}: ${nodeLabel(node)} has a malformed durable identifier`
      + `${ids[0] ? ` "${ids[0]}"` : ''}. `
      + 'Use letters, numbers, underscores, or hyphens and run pickle check again.',
    )
    return
  }
  recordIdentifier(seen, ids[0], uri, errors)
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
        `Invalid Specification ${file.uri}: Feature is missing. `
        + 'Correct the Specification and run pickle check again.',
      )
      continue
    }
    for (const node of identityNodes(feature)) validateNode(node, file.uri, seen, errors)
  }
  if (errors.length > 0) throw new Error(errors.join('\n'))
}

function createDurableId(existing: Set<string>): string {
  for (;;) {
    const id = Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString('hex')
    if (!existing.has(id)) {
      existing.add(id)
      return id
    }
  }
}

function collectExistingIds(features: readonly (Feature | undefined)[]): Set<string> {
  const existing = new Set<string>()
  for (const feature of features) {
    if (!feature) continue
    for (const node of identityNodes(feature)) {
      for (const id of idValues(node.tags)) {
        if (id) existing.add(id)
      }
      const rowId = node.pickleIdValue?.trim()
      if (rowId) existing.add(rowId)
    }
  }
  return existing
}

function splitSource(source: string): { lines: string[]; newline: string } {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  return { lines: source.split(newline), newline }
}

function insertTableColumn(line: string, value: string): string {
  const parts = line.split('|')
  parts.splice(1, 0, ` ${value} `)
  return parts.join('|')
}

function fillTableCell(line: string, columnIndex: number, value: string): string {
  const parts = line.split('|')
  parts[columnIndex + 1] = ` ${value} `
  return parts.join('|')
}

function applyEdits(source: string, edits: readonly SourceEdit[]): string {
  const { lines, newline } = splitSource(source)
  const lineEdits = edits
    .filter(edit => edit.type === 'insert-line')
    .sort((left, right) => right.beforeLine - left.beforeLine)

  for (const edit of edits) {
    if (edit.type === 'insert-line') continue
    const line = lines[edit.line - 1]
    if (line === undefined) continue
    if (edit.type === 'insert-column') lines[edit.line - 1] = insertTableColumn(line, edit.value)
    else lines[edit.line - 1] = fillTableCell(line, edit.columnIndex, edit.value)
  }
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
  existing: Set<string>,
): { nextSource: string; changes: SpecificationMigrationChange[] } {
  if (!feature) return { nextSource: file.source, changes: [] }

  const edits: SourceEdit[] = []
  const changes: SpecificationMigrationChange[] = []
  const nodes = identityNodes(feature)

  for (const node of nodes) {
    if (node.kind === 'examples-row') {
      const current = node.pickleIdValue?.trim() ?? ''
      if (current) continue
      const id = createDurableId(existing)
      if (node.pickleIdColumnIndex === undefined) {
        edits.push({ type: 'insert-column', line: node.line, value: id })
      } else {
        edits.push({ type: 'fill-cell', line: node.line, columnIndex: node.pickleIdColumnIndex, value: id })
      }
      changes.push({ uri: file.uri, description: `Examples row ${node.rowIndex}: add pickle_id ${id}` })
      continue
    }

    if (node.kind === 'examples' && node.pickleIdColumnIndex === undefined && node.headerLine) {
      edits.push({ type: 'insert-column', line: node.headerLine, value: ROW_ID_COLUMN })
    }

    const tagsToAdd: string[] = []
    const ids = idValues(node.tags)
    const states = stateValues(node.tags)
    if (ids.length === 0) {
      const id = createDurableId(existing)
      tagsToAdd.push(`${ID_TAG_PREFIX}${id}`)
    }
    if (node.kind === 'feature' && states.length === 0) {
      tagsToAdd.push(`${STATE_TAG_PREFIX}active`)
    }
    if (tagsToAdd.length === 0) continue
    edits.push({ type: 'insert-line', beforeLine: node.line, text: tagLine(node.column, tagsToAdd) })
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
  const parsed = files.map(file => ({ file, feature: parseDocument(file.source, language).feature }))
  const existing = collectExistingIds(parsed.map(({ feature }) => feature))
  const changes: SpecificationMigrationChange[] = []
  const nextFiles: SpecificationMigrationFile[] = []
  for (const { file, feature } of parsed) {
    const migrated = migrateFile(file, feature, existing)
    changes.push(...migrated.changes)
    nextFiles.push({ uri: file.uri, source: file.source, nextSource: migrated.nextSource })
  }
  return { changes, files: nextFiles }
}

export function formatMigrationPreview(plan: SpecificationMigrationPlan): string {
  if (plan.changes.length === 0) return 'No Specification metadata changes needed'
  const uris = [...new Set(plan.changes.map(change => change.uri))]
  const sections = uris.map(uri => {
    const lines = plan.changes.filter(change => change.uri === uri).map(change => `  ${change.description}`)
    return `${uri}\n${lines.join('\n')}`
  })
  return `Migration preview\n\n${sections.join('\n\n')}\n`
}
