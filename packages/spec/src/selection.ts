import type { SpecificationState } from './identity'
import type { Scenario, Specification } from './specification'

export interface Shard {
  index: number
  total: number
}

export interface SelectionOptions {
  paths?: string | readonly string[]
  scenarioName?: string
  tagExpression?: string
  states?: readonly SpecificationState[]
  shard?: Shard
}

const specificationStates = ['draft', 'active', 'deprecated'] as const

export interface ScenarioSelection {
  specification: Specification
  scenario: Scenario
}

type TagExpressionNode =
  | { type: 'tag'; value: string }
  | { type: 'not'; child: TagExpressionNode }
  | { type: 'and' | 'or'; left: TagExpressionNode; right: TagExpressionNode }

function normalizedTag(tag: string): string {
  return tag.startsWith('@') ? tag : `@${tag}`
}

function tagExpressionTokens(expression: string): string[] {
  const tokens: string[] = []
  const tokenPattern = /\(|\)|(?:and|or|not)\b|@?[A-Za-z0-9:_-]+/iy
  let index = 0
  while (index < expression.length) {
    while (index < expression.length && /\s/.test(expression[index]!)) index++
    if (index === expression.length) break
    tokenPattern.lastIndex = index
    const match = tokenPattern.exec(expression)
    if (!match)
      throw new Error(
        `Unexpected character "${expression[index]}" in tag expression`,
      )
    tokens.push(match[0])
    index = tokenPattern.lastIndex
  }
  return tokens
}

function parseTagExpression(expression: string): TagExpressionNode {
  const tokens = tagExpressionTokens(expression)
  let index = 0

  function consume(): string {
    const token = tokens[index++]
    if (!token) throw new Error('Unexpected end of tag expression')
    return token
  }

  function primary(): TagExpressionNode {
    const token = consume()
    if (token === '(') {
      const node = or()
      if (consume() !== ')') throw new Error('Expected ")" in tag expression')
      return node
    }
    if (/^not$/i.test(token)) return { type: 'not', child: primary() }
    if (/^(and|or)$/i.test(token)) {
      throw new Error(`Unexpected operator "${token}" in tag expression`)
    }
    return { type: 'tag', value: normalizedTag(token) }
  }

  function and(): TagExpressionNode {
    let left = primary()
    while (/^and$/i.test(tokens[index] ?? '')) {
      index++
      left = { type: 'and', left, right: primary() }
    }
    return left
  }

  function or(): TagExpressionNode {
    let left = and()
    while (/^or$/i.test(tokens[index] ?? '')) {
      index++
      left = { type: 'or', left, right: and() }
    }
    return left
  }

  const result = or()
  if (index !== tokens.length) {
    throw new Error(`Unexpected token "${tokens[index]}" in tag expression`)
  }
  return result
}

function matchesTagExpression(
  node: TagExpressionNode,
  tags: readonly string[],
): boolean {
  switch (node.type) {
    case 'tag':
      return tags.includes(node.value)
    case 'not':
      return !matchesTagExpression(node.child, tags)
    case 'and':
      return (
        matchesTagExpression(node.left, tags) &&
        matchesTagExpression(node.right, tags)
      )
    case 'or':
      return (
        matchesTagExpression(node.left, tags) ||
        matchesTagExpression(node.right, tags)
      )
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function knownFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  parent: string,
): void {
  for (const field of Object.keys(value)) {
    if (!fields.includes(field))
      throw new Error(`${parent}.${field} is not supported`)
  }
}

function optionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${field} must be a string`)
  }
}

function validateShard(value: unknown): void {
  const shard = record(value, 'selection.shard')
  knownFields(shard, ['index', 'total'], 'selection.shard')
  if (!Number.isInteger(shard.index) || (shard.index as number) < 1) {
    throw new Error(
      'selection.shard.index must be an integer greater than or equal to 1',
    )
  }
  if (!Number.isInteger(shard.total) || (shard.total as number) < 1) {
    throw new Error(
      'selection.shard.total must be an integer greater than or equal to 1',
    )
  }
  if ((shard.index as number) > (shard.total as number)) {
    throw new Error(
      'selection.shard.index must be less than or equal to selection.shard.total',
    )
  }
}

function globToRegExp(pattern: string): RegExp {
  let regex = '^'
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        regex += '.*'
        index++
        continue
      }
      regex += '[^/]*'
      continue
    }
    if ('\\^$+{}()|[]?'.includes(character) || character === '.') {
      regex += `\\${character}`
      continue
    }
    regex += character
  }
  return new RegExp(`${regex}$`)
}

function normalizePaths(value: unknown): string[] {
  if (typeof value === 'string') {
    if (!value.trim()) {
      throw new Error('selection.paths must contain at least one path')
    }
    return [value]
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('selection.paths must contain at least one path')
  }
  if (!value.every((path) => typeof path === 'string' && path.trim())) {
    throw new Error('selection.paths must not contain an empty path')
  }
  return value
}

function matchesPath(uri: string, pattern: string): boolean {
  return globToRegExp(pattern.replaceAll('\\', '/')).test(
    uri.replaceAll('\\', '/'),
  )
}

function validateStates(value: unknown): SpecificationState[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      'selection.states must contain at least one Specification state',
    )
  }
  if (
    !value.every(
      (state) =>
        typeof state === 'string' &&
        specificationStates.includes(state as SpecificationState),
    )
  ) {
    throw new Error('selection.states must be draft, active, or deprecated')
  }
  return value as SpecificationState[]
}

export function validateSelectionOptions(value: unknown): SelectionOptions {
  const options = record(value, 'selection')
  knownFields(
    options,
    ['paths', 'scenarioName', 'tagExpression', 'states', 'shard'],
    'selection',
  )
  optionalString(options.scenarioName, 'selection.scenarioName')
  optionalString(options.tagExpression, 'selection.tagExpression')
  if (options.paths !== undefined) options.paths = normalizePaths(options.paths)
  if (options.states !== undefined)
    options.states = validateStates(options.states)
  if (options.tagExpression) parseTagExpression(options.tagExpression as string)
  if (options.shard !== undefined) validateShard(options.shard)
  return options as unknown as SelectionOptions
}

export function selectScenarios(
  specifications: readonly Specification[],
  options: SelectionOptions = {},
): ScenarioSelection[] {
  const validatedOptions = validateSelectionOptions(options)
  const name = validatedOptions.scenarioName?.trim().toLowerCase()
  const tagExpression = validatedOptions.tagExpression
    ? parseTagExpression(validatedOptions.tagExpression)
    : undefined

  const paths = validatedOptions.paths ? [validatedOptions.paths].flat() : []
  const states = new Set<SpecificationState>(
    validatedOptions.states ?? ['active'],
  )

  const selected = [...specifications]
    .sort((left, right) => left.source.uri.localeCompare(right.source.uri))
    .filter(
      (specification) =>
        paths.length === 0 ||
        paths.some((path) => matchesPath(specification.source.uri, path)),
    )
    .filter((specification) => states.has(specification.state ?? 'active'))
    .flatMap((specification) =>
      specification.scenarios.map((scenario) => ({ specification, scenario })),
    )
    .filter(
      ({ scenario }) => !name || scenario.name.toLowerCase().includes(name),
    )
    .filter(
      ({ scenario }) =>
        !tagExpression || matchesTagExpression(tagExpression, scenario.tags),
    )

  if (!validatedOptions.shard) return selected

  return selected
    .filter(({ scenario }) => !scenario.tags.includes('@ignore'))
    .filter(
      (_, index) =>
        index % validatedOptions.shard!.total ===
        validatedOptions.shard!.index - 1,
    )
}
