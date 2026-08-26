import {
  optionalString,
  parseConfiguration,
  strictObject,
} from '@pickle-spec/configuration'
import { z } from 'zod'
import {
  type SpecificationState,
  specificationStates,
} from '../identity/identity'
import type { Scenario, Specification } from '../parsing/specification'
import { selectShard } from './sharding'
import { createTagPredicate, validateTagExpression } from './tag-expression'

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
    validateTagExpression(options.tagExpression)
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
  const matchesTags = createTagPredicate(options.tagExpression)

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
    .filter(({ scenario }) => matchesTags(scenario.tags))

  if (!options.shard) return selected

  const shardable = selected.filter(
    ({ scenario }) => !scenario.tags.includes(ignoreTag),
  )
  return selectShard({
    selected,
    shardable,
    shard: options.shard,
    historicalDurations: context.historicalDurations,
  })
}
