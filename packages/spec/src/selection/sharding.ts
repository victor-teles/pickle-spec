import { resolveScenarioId } from '../identity/identity'
import type { Scenario, Specification } from '../parsing/specification'
import type { ScenarioSelection, Shard } from './selection'

type RankedSelection = {
  key: string
  duration: number
}

interface SelectShardInput {
  selected: readonly ScenarioSelection[]
  shardable: readonly ScenarioSelection[]
  shard: Shard
  historicalDurations?: Readonly<Record<string, number>>
}

function selectionKey(
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
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

function shardByCount(
  selections: readonly ScenarioSelection[],
  shard: Shard,
): ScenarioSelection[] {
  return selections.filter(
    (_, index) => index % shard.total === shard.index - 1,
  )
}

function rankedSelections(
  selections: readonly ScenarioSelection[],
  historicalDurations: Readonly<Record<string, number>>,
): RankedSelection[] | undefined {
  const fallbackDuration = median(Object.values(historicalDurations))
  const ranked = selections.map((selection) => {
    const key = selectionKey(selection.specification, selection.scenario)
    return {
      key,
      duration: historicalDurations[key] ?? fallbackDuration,
    }
  })
  const hasAnyHistory = ranked.some(
    ({ key }) => historicalDurations[key] !== undefined,
  )
  if (!hasAnyHistory) return undefined
  return ranked.sort(
    (left, right) =>
      right.duration - left.duration || left.key.localeCompare(right.key),
  )
}

function leastLoadedShard(shardTotals: readonly number[]): number {
  let target = 0
  for (let index = 1; index < shardTotals.length; index++) {
    if (shardTotals[index]! < shardTotals[target]!) target = index
  }
  return target
}

function durationAssignments(
  ranked: readonly RankedSelection[],
  shardCount: number,
): ReadonlyMap<string, number> {
  const totals = Array.from({ length: shardCount }, () => 0)
  const assignments = new Map<string, number>()
  for (const entry of ranked) {
    const target = leastLoadedShard(totals)
    assignments.set(entry.key, target)
    totals[target] = totals[target]! + entry.duration
  }
  return assignments
}

function shardByDuration(
  selections: readonly ScenarioSelection[],
  shard: Shard,
  historicalDurations: Readonly<Record<string, number>>,
): ScenarioSelection[] {
  const ranked = rankedSelections(selections, historicalDurations)
  if (!ranked) return shardByCount(selections, shard)

  const assignments = durationAssignments(ranked, shard.total)
  return selections.filter(
    ({ specification, scenario }) =>
      assignments.get(selectionKey(specification, scenario)) ===
      shard.index - 1,
  )
}

export function selectShard(input: SelectShardInput): ScenarioSelection[] {
  const sharded = input.historicalDurations
    ? shardByDuration(input.shardable, input.shard, input.historicalDurations)
    : shardByCount(input.shardable, input.shard)
  const selectedKeys = new Set(
    sharded.map(({ specification, scenario }) =>
      selectionKey(specification, scenario),
    ),
  )
  return input.selected.filter(({ specification, scenario }) =>
    selectedKeys.has(selectionKey(specification, scenario)),
  )
}
