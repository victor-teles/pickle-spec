import {
  optionalString,
  parseConfiguration,
  strictObject,
} from '@pickle-spec/configuration'
import { z } from 'zod'
import {
  resolveScenarioId,
  type SpecificationState,
  specificationStates,
} from '../identity/identity'
import type { Scenario, Specification } from '../parsing/specification'

export interface Shard {
  index: number
  total: number
}

export interface SelectScenariosContext {
  historicalDurations?: Readonly<Record<string, number>>
}

export interface SelectionOptions {
  paths?: string | readonly string[]
  scenarioName?: string
  tagExpression?: string
  states?: readonly SpecificationState[]
  shard?: Shard
}

export interface ScenarioSelection {
  specification: Specification
  scenario: Scenario
}

export const ignoreTag = '@ignore'

type TagExpressionNode =
  | { type: 'tag'; value: string }
  | { type: 'not'; child: TagExpressionNode }
  | { type: 'and' | 'or'; left: TagExpressionNode; right: TagExpressionNode }

function positiveInteger(field: string) {
  return z
    .number({
      error: `${field} must be an integer greater than or equal to 1`,
    })
    .int({
      error: `${field} must be an integer greater than or equal to 1`,
    })
    .min(1, {
      error: `${field} must be an integer greater than or equal to 1`,
    })
}

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

const selectionPathsSchema = z.union(
  [
    z.string().refine((value) => value.trim().length > 0, {
      error: 'selection.paths must contain at least one path',
    }),
    z
      .array(
        z.string().refine((value) => value.trim().length > 0, {
          error: 'selection.paths must not contain an empty path',
        }),
        { error: 'selection.paths must contain at least one path' },
      )
      .min(1, { error: 'selection.paths must contain at least one path' }),
  ],
  { error: 'selection.paths must contain at least one path' },
)

const shardSchema = strictObject('selection.shard', {
  index: positiveInteger('selection.shard.index'),
  total: positiveInteger('selection.shard.total'),
}).refine((shard) => shard.index <= shard.total, {
  error:
    'selection.shard.index must be less than or equal to selection.shard.total',
})

export const selectionOptionsSchema = strictObject('selection', {
  paths: selectionPathsSchema.optional(),
  scenarioName: optionalString('selection.scenarioName'),
  tagExpression: optionalString('selection.tagExpression'),
  states: z
    .array(
      z.enum(specificationStates, {
        error: 'selection.states must be draft, active, or deprecated',
      }),
      { error: 'selection.states must be draft, active, or deprecated' },
    )
    .min(1, {
      error: 'selection.states must contain at least one Specification state',
    })
    .optional(),
  shard: shardSchema.optional(),
}).superRefine((options, context) => {
  if (!options.tagExpression) return
  try {
    parseTagExpression(options.tagExpression)
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

function matchesPath(uri: string, pattern: string): boolean {
  return new Bun.Glob(pattern.replaceAll('\\', '/')).match(
    uri.replaceAll('\\', '/'),
  )
}

function assertShard(shard: Shard): void {
  if (shard.index > shard.total) {
    throw new Error(
      'selection.shard.index must be less than or equal to selection.shard.total',
    )
  }
}

function scenarioSelectionKey(
  specification: Specification,
  scenario: Scenario,
): string {
  return resolveScenarioId(
    specification.source.uri,
    specification.name,
    scenario.name,
    scenario.tags,
  )
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2
  }
  return sorted[middle]!
}

function shardByCount(
  selections: readonly ScenarioSelection[],
  shard: Shard,
): ScenarioSelection[] {
  return selections.filter(
    (_, index) => index % shard.total === shard.index - 1,
  )
}

function shardByDuration(
  selections: readonly ScenarioSelection[],
  shard: Shard,
  historicalDurations: Readonly<Record<string, number>>,
): ScenarioSelection[] {
  const knownDurations = Object.values(historicalDurations)
  const fallbackDuration = median(knownDurations)
  const hasAnyHistory = selections.some(({ specification, scenario }) => {
    const key = scenarioSelectionKey(specification, scenario)
    return historicalDurations[key] !== undefined
  })
  if (!hasAnyHistory) return shardByCount(selections, shard)

  const ranked = selections
    .map((selection) => {
      const key = scenarioSelectionKey(
        selection.specification,
        selection.scenario,
      )
      return {
        selection,
        key,
        duration: historicalDurations[key] ?? fallbackDuration,
      }
    })
    .sort(
      (left, right) =>
        right.duration - left.duration || left.key.localeCompare(right.key),
    )

  const shardTotals = Array.from({ length: shard.total }, () => 0)
  const shardAssignments = new Map<string, number>()

  for (const entry of ranked) {
    let targetShard = 0
    let lowestTotal = shardTotals[0]!
    for (let index = 1; index < shardTotals.length; index++) {
      const total = shardTotals[index]!
      if (total < lowestTotal) {
        lowestTotal = total
        targetShard = index
      }
    }
    shardAssignments.set(entry.key, targetShard)
    shardTotals[targetShard] = lowestTotal + entry.duration
  }

  return selections.filter(({ specification, scenario }) => {
    const key = scenarioSelectionKey(specification, scenario)
    return shardAssignments.get(key) === shard.index - 1
  })
}

export function validateSelectionOptions(value: unknown): SelectionOptions {
  return parseConfiguration(selectionOptionsSchema, value, 'Invalid selection')
}

export function selectScenarios(
  specifications: readonly Specification[],
  options: SelectionOptions = {},
  context: SelectScenariosContext = {},
): ScenarioSelection[] {
  if (options.shard) assertShard(options.shard)
  const name = options.scenarioName?.trim().toLowerCase()
  const tagExpression = options.tagExpression
    ? parseTagExpression(options.tagExpression)
    : undefined

  const paths = options.paths ? [options.paths].flat() : []
  const states = new Set<SpecificationState>(options.states ?? ['active'])

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

  if (!options.shard) return selected

  const shardable = selected.filter(
    ({ scenario }) => !scenario.tags.includes(ignoreTag),
  )
  const sharded = context.historicalDurations
    ? shardByDuration(shardable, options.shard, context.historicalDurations)
    : shardByCount(shardable, options.shard)
  const shardedKeys = new Set(
    sharded.map(({ specification, scenario }) =>
      scenarioSelectionKey(specification, scenario),
    ),
  )
  return selected.filter(({ specification, scenario }) =>
    shardedKeys.has(scenarioSelectionKey(specification, scenario)),
  )
}
