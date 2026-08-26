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
import {
  identifierDigest,
  idPattern,
  idValues,
  resolveExamplesId,
  resolveScenarioId,
  resolveSpecificationId,
  rowIdColumn,
  specificationStates,
  stateTagPrefix,
  stateValues,
} from './identity-core'

export interface SpecificationSourceFile {
  uri: string
  source: string
}

export interface IdentityNode {
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

export function parseIdentityDocument(source: string, language = 'en') {
  return new Parser(
    new AstBuilder(IdGenerator.incrementing()),
    new GherkinClassicTokenMatcher(language),
  ).parse(source)
}

export function nodeLabel(node: IdentityNode): string {
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

export function identityNodes(feature: Feature): IdentityNode[] {
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
  switch (node.kind) {
    case 'examples-row': {
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
    case 'feature':
      return resolveSpecificationId(uri, node.specificationName, node.tags)
    case 'scenario':
      return resolveScenarioId(
        uri,
        node.specificationName,
        node.scenarioName ?? '',
        node.tags,
      )
    case 'examples':
      return resolveExamplesId(
        uri,
        node.specificationName,
        node.scenarioName ?? '',
        node.examplesName ?? '',
        node.tags,
      )
  }
}

function validateExamplesRow(
  node: IdentityNode,
  uri: string,
  seen: Map<string, string>,
  errors: string[],
): void {
  const explicit = node.pickleIdValue?.trim() ?? ''
  if (explicit && !idPattern.test(explicit)) {
    errors.push(
      `Invalid Specification ${uri}: Examples row ${node.rowIndex} has a malformed durable identifier "${explicit}". ` +
        'Use letters, numbers, underscores, or hyphens and run pickle check again.',
    )
    return
  }
  recordIdentifier(seen, resolvedNodeId(node, uri), uri, errors)
}

function validateSpecificationState(
  node: IdentityNode,
  uri: string,
  errors: string[],
): void {
  const states = stateValues(node.tags)
  if (node.kind !== 'feature') {
    if (states.length === 0) return
    errors.push(
      `Invalid Specification ${uri}: ${nodeLabel(node)} has a Specification state tag. ` +
        'Declare draft, active, or deprecated on the Feature and run pickle check again.',
    )
    return
  }
  if (states.length > 1) {
    errors.push(
      `Invalid Specification ${uri}: Feature has conflicting Specification states ` +
        `${states.map((state) => `${stateTagPrefix}${state}`).join(' and ')}. ` +
        'Keep one of draft, active, or deprecated and run pickle check again.',
    )
    return
  }
  if (states.length === 0) {
    errors.push(
      `Invalid Specification ${uri}: Feature is missing a Specification state. ` +
        'Run pickle migrate to add missing metadata.',
    )
    return
  }
  if (!specificationStates.some((state) => state === states[0])) {
    errors.push(
      `Invalid Specification ${uri}: Feature has a malformed Specification state "${states[0]}". ` +
        'Use draft, active, or deprecated and run pickle check again.',
    )
  }
}

function hasValidIdentifier(
  node: IdentityNode,
  uri: string,
  errors: string[],
): boolean {
  const ids = idValues(node.tags)
  if (ids.length > 1) {
    errors.push(
      `Invalid Specification ${uri}: ${nodeLabel(node)} has conflicting durable identifiers. ` +
        'Keep one @pickle:id tag and run pickle check again.',
    )
    return false
  }
  if (ids.length === 1 && (!ids[0] || !idPattern.test(ids[0]))) {
    errors.push(
      `Invalid Specification ${uri}: ${nodeLabel(node)} has a malformed durable identifier` +
        `${ids[0] ? ` "${ids[0]}"` : ''}. ` +
        'Use letters, numbers, underscores, or hyphens and run pickle check again.',
    )
    return false
  }
  return true
}

function validateNode(
  node: IdentityNode,
  uri: string,
  seen: Map<string, string>,
  errors: string[],
): void {
  if (node.kind === 'examples-row') {
    validateExamplesRow(node, uri, seen, errors)
    return
  }
  validateSpecificationState(node, uri, errors)
  if (!hasValidIdentifier(node, uri, errors)) return
  recordIdentifier(seen, resolvedNodeId(node, uri), uri, errors)
}

export function validateSpecificationMetadata(
  files: readonly SpecificationSourceFile[],
  language = 'en',
): void {
  const seen = new Map<string, string>()
  const errors: string[] = []
  for (const file of files) {
    const feature = parseIdentityDocument(file.source, language).feature
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
