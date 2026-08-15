import { describe, expect, test } from 'bun:test'
import type { ParsedFeature } from './parser'
import { applyFilters, applyShard, filterPicklesByTagExpression } from './selection'

function makeStep(id: string, text: string) {
  return {
    id,
    text,
    astNodeIds: [`${id}-ast`],
  }
}

function makePickle(name: string, tags: string[] = []) {
  return {
    id: `${name}-id`,
    name,
    language: 'en',
    uri: `file:///tmp/${name}.feature`,
    steps: [makeStep(`${name}-step`, 'I do something')],
    tags: tags.map((tag, index) => ({
      id: `${name}-tag-${index}`,
      name: tag,
      astNodeId: `${name}-tag-ast-${index}`,
    })),
    astNodeIds: [`${name}-ast`],
  }
}

function makeFeature(filePath: string, featureName: string, pickles: ReturnType<typeof makePickle>[]): ParsedFeature {
  return {
    filePath,
    featureName,
    document: {} as any,
    pickles,
  }
}

describe('filterPicklesByTagExpression', () => {
  test('supports cucumber-style boolean expressions', () => {
    const pickles = [
      makePickle('Smoke checkout', ['@smoke', '@checkout']),
      makePickle('Ignored smoke', ['@smoke', '@ignore']),
      makePickle('Regression only', ['@regression']),
    ]

    const filtered = filterPicklesByTagExpression(pickles, '@smoke and not @ignore')

    expect(filtered.map(pickle => pickle.name)).toEqual(['Smoke checkout'])
  })
})

describe('applyFilters', () => {
  test('filters scenarios by case-insensitive substring and tag expression', () => {
    const features = [
      makeFeature('/tmp/checkout.feature', 'Checkout', [
        makePickle('Happy checkout', ['@smoke']),
        makePickle('Sad checkout', ['@regression']),
      ]),
      makeFeature('/tmp/profile.feature', 'Profile', [
        makePickle('Profile smoke', ['@smoke']),
      ]),
    ]

    const filtered = applyFilters(features, {
      scenarioName: 'checkout',
      tagExpression: '@smoke',
    })

    expect(filtered).toHaveLength(1)
    expect(filtered[0]!.pickles.map(pickle => pickle.name)).toEqual(['Happy checkout'])
  })
})

describe('applyShard', () => {
  test('allocates filtered runnable scenarios deterministically', () => {
    const features = [
      makeFeature('/tmp/b.feature', 'B', [
        makePickle('Scenario B1', ['@smoke']),
        makePickle('Scenario B2', ['@smoke']),
      ]),
      makeFeature('/tmp/a.feature', 'A', [
        makePickle('Scenario A1', ['@smoke']),
        makePickle('Scenario A2', ['@smoke']),
      ]),
    ]

    const shard = applyShard(features, { index: 2, total: 2 })

    expect(shard.map(feature => ({
      feature: feature.featureName,
      scenarios: feature.pickles.map(pickle => pickle.name),
    }))).toEqual([
      { feature: 'A', scenarios: ['Scenario A2'] },
      { feature: 'B', scenarios: ['Scenario B2'] },
    ])
  })

  test('omits ignored scenarios from shard allocation', () => {
    const features = [
      makeFeature('/tmp/a.feature', 'A', [
        makePickle('Ignored scenario', ['@ignore']),
        makePickle('Runnable one', ['@smoke']),
        makePickle('Runnable two', ['@smoke']),
      ]),
    ]

    const shard = applyShard(features, { index: 1, total: 2 })

    expect(shard[0]!.pickles.map(pickle => pickle.name)).toEqual(['Runnable one'])
  })
})
