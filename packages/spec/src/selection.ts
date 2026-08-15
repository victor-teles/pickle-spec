import type { Scenario, Specification } from './specification'

export interface Shard {
  index: number
  total: number
}

export interface SelectionOptions {
  scenarioName?: string
  tagExpression?: string
  shard?: Shard
}

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

function parseTagExpression(expression: string): TagExpressionNode {
  const tokens = expression.match(/\(|\)|\b(?:and|or|not)\b|@?[A-Za-z0-9:_-]+/gi) ?? []
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

function matchesTagExpression(node: TagExpressionNode, tags: readonly string[]): boolean {
  switch (node.type) {
    case 'tag': return tags.includes(node.value)
    case 'not': return !matchesTagExpression(node.child, tags)
    case 'and':
      return matchesTagExpression(node.left, tags) && matchesTagExpression(node.right, tags)
    case 'or':
      return matchesTagExpression(node.left, tags) || matchesTagExpression(node.right, tags)
  }
}

function validateShard(shard: Shard): void {
  if (!Number.isInteger(shard.index) || shard.index < 1) {
    throw new Error('shard.index must be an integer greater than or equal to 1')
  }
  if (!Number.isInteger(shard.total) || shard.total < 1) {
    throw new Error('shard.total must be an integer greater than or equal to 1')
  }
  if (shard.index > shard.total) {
    throw new Error('shard.index must be less than or equal to shard.total')
  }
}

export function selectScenarios(
  specifications: readonly Specification[],
  options: SelectionOptions = {},
): ScenarioSelection[] {
  const name = options.scenarioName?.trim().toLowerCase()
  const tagExpression = options.tagExpression
    ? parseTagExpression(options.tagExpression)
    : undefined

  const selected = [...specifications]
    .sort((left, right) => left.source.uri.localeCompare(right.source.uri))
    .flatMap(specification => specification.scenarios.map(scenario => ({ specification, scenario })))
    .filter(({ scenario }) => !name || scenario.name.toLowerCase().includes(name))
    .filter(({ scenario }) => !tagExpression || matchesTagExpression(tagExpression, scenario.tags))

  if (!options.shard) return selected
  validateShard(options.shard)

  return selected
    .filter(({ scenario }) => !scenario.tags.includes('@ignore'))
    .filter((_, index) => index % options.shard!.total === options.shard!.index - 1)
}
