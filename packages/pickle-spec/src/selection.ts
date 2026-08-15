import type { Pickle } from '@cucumber/messages'
import type { ParsedFeature } from './parser'
import type { FilterConfig, ShardConfig } from './types'
import { hasIgnoreTag } from './parser'

type TagExpressionNode =
  | { type: 'tag'; value: string }
  | { type: 'not'; child: TagExpressionNode }
  | { type: 'and' | 'or'; left: TagExpressionNode; right: TagExpressionNode }

function normalizeTag(tag: string): string {
  return tag.startsWith('@') ? tag : `@${tag}`
}

function tokenizeTagExpression(expression: string): string[] {
  const tokens = expression.match(/\(|\)|\b(?:and|or|not)\b|@?[A-Za-z0-9:_-]+/gi)
  if (!tokens) return []
  return tokens
}

function parseTagExpression(expression: string): TagExpressionNode {
  const tokens = tokenizeTagExpression(expression)
  let index = 0

  function peek(): string | undefined {
    return tokens[index]
  }

  function consume(): string {
    const token = tokens[index]
    if (!token) throw new Error('Unexpected end of tag expression')
    index++
    return token
  }

  function parsePrimary(): TagExpressionNode {
    const token = consume()
    if (token === '(') {
      const node = parseOr()
      if (consume() !== ')') {
        throw new Error('Expected ")" in tag expression')
      }
      return node
    }

    if (/^not$/i.test(token)) {
      return { type: 'not', child: parsePrimary() }
    }

    if (/^(and|or)$/i.test(token)) {
      throw new Error(`Unexpected operator "${token}" in tag expression`)
    }

    return { type: 'tag', value: normalizeTag(token) }
  }

  function parseAnd(): TagExpressionNode {
    let left = parsePrimary()
    while (peek() && /^and$/i.test(peek()!)) {
      consume()
      left = { type: 'and', left, right: parsePrimary() }
    }
    return left
  }

  function parseOr(): TagExpressionNode {
    let left = parseAnd()
    while (peek() && /^or$/i.test(peek()!)) {
      consume()
      left = { type: 'or', left, right: parseAnd() }
    }
    return left
  }

  const node = parseOr()
  if (index !== tokens.length) {
    throw new Error(`Unexpected token "${tokens[index]}" in tag expression`)
  }
  return node
}

function evaluateTagExpression(node: TagExpressionNode, pickle: Pickle): boolean {
  switch (node.type) {
    case 'tag':
      return pickle.tags.some(tag => tag.name === node.value)
    case 'not':
      return !evaluateTagExpression(node.child, pickle)
    case 'and':
      return evaluateTagExpression(node.left, pickle) && evaluateTagExpression(node.right, pickle)
    case 'or':
      return evaluateTagExpression(node.left, pickle) || evaluateTagExpression(node.right, pickle)
  }
}

export function filterPicklesByTagExpression(pickles: readonly Pickle[], expression: string): Pickle[] {
  const tree = parseTagExpression(expression)
  return pickles.filter(pickle => evaluateTagExpression(tree, pickle))
}

export function filterPicklesByScenarioName(pickles: readonly Pickle[], query: string): Pickle[] {
  const normalized = query.trim().toLowerCase()
  return pickles.filter(pickle => pickle.name.toLowerCase().includes(normalized))
}

export function applyFilters(features: ParsedFeature[], filter?: FilterConfig): ParsedFeature[] {
  if (!filter?.scenarioName && !filter?.tagExpression) return features

  return features
    .map(feature => {
      let pickles = [...feature.pickles]
      if (filter.scenarioName) {
        pickles = filterPicklesByScenarioName(pickles, filter.scenarioName)
      }
      if (filter.tagExpression) {
        pickles = filterPicklesByTagExpression(pickles, filter.tagExpression)
      }
      return { ...feature, pickles }
    })
    .filter(feature => feature.pickles.length > 0)
}

export function applyShard(features: ParsedFeature[], shard?: ShardConfig): ParsedFeature[] {
  if (!shard) return features

  const orderedFeatures = [...features].sort((a, b) => a.filePath.localeCompare(b.filePath))
  const assignments = new Map<string, Set<string>>()
  let ordinal = 0

  for (const feature of orderedFeatures) {
    for (const pickle of feature.pickles) {
      if (hasIgnoreTag(pickle)) continue
      if (ordinal % shard.total === shard.index - 1) {
        let set = assignments.get(feature.filePath)
        if (!set) {
          set = new Set<string>()
          assignments.set(feature.filePath, set)
        }
        set.add(pickle.id)
      }
      ordinal++
    }
  }

  return orderedFeatures
    .map(feature => ({
      ...feature,
      pickles: feature.pickles.filter(pickle => assignments.get(feature.filePath)?.has(pickle.id)),
    }))
    .filter(feature => feature.pickles.length > 0)
}
