import { describe, expect, test } from 'bun:test'
import type { ExecutionPlan, ExecutionPlanStore } from '@pickle-spec/runner'
import type { Scenario, Specification } from '@pickle-spec/spec'
import { resolveScenarioId, scenarioRevision } from '@pickle-spec/spec'
import {
  evaluatePerformanceGates,
  runWebPerformanceBenchmark,
} from './web-benchmark'

const scenario: Scenario = {
  name: 'Search for pickles',
  tags: [],
  steps: [
    { keyword: 'Given', text: 'I navigate to /search', type: 'context' },
    { keyword: 'When', text: 'I search for pickles', type: 'action' },
    { keyword: 'Then', text: 'pickle results are visible', type: 'outcome' },
  ],
}

const specification: Specification = {
  name: 'Search',
  source: { uri: 'features/search.feature', language: 'en' },
  tags: [],
  scenarios: [scenario],
}

function approvedPlan(scenarioId: string): ExecutionPlan {
  return {
    schemaVersion: 1,
    scenarioId,
    scenarioRevision: scenarioRevision(scenario),
    executionTargetProfileId: 'web',
    planFormatVersion: 'web.1',
    steps: [
      {
        resolvedActions: [
          { description: 'Navigate to https://example.test/search' },
        ],
      },
      {
        resolvedActions: [
          {
            description: 'Search for pickles',
            replay: { selector: '#search' },
          },
        ],
      },
      {
        resolvedActions: [
          { description: 'Verify: pickle results are visible' },
        ],
      },
    ],
  }
}

function planStore(scenarioId: string): ExecutionPlanStore {
  const plan = approvedPlan(scenarioId)
  return {
    async findApproved(query) {
      return query.scenarioId === plan.scenarioId ? plan : undefined
    },
    async saveCandidate() {},
  }
}

describe('runWebPerformanceBenchmark', () => {
  test('records cold and warm Adaptive and Replay samples with timing breakdown', async () => {
    const scenarioId = resolveScenarioId(
      specification.source.uri,
      specification.name,
      scenario.name,
      scenario.tags,
    )
    const result = await runWebPerformanceBenchmark({
      selections: [{ specification, scenario }],
      options: { baseUrl: 'https://example.test' },
      plans: planStore(scenarioId),
      delays: {
        launchMs: 100,
        navigationMs: 80,
        modelCallMs: 50,
        artifactMs: 10,
      },
    })

    const adaptiveCold = result.candidate.adaptive.cold[0]!
    const adaptiveWarm = result.candidate.adaptive.warm[0]!

    expect(result.baseline.adaptive.cold).toHaveLength(1)
    expect(result.baseline.adaptive.warm).toHaveLength(1)
    expect(result.baseline.replay.cold).toHaveLength(1)
    expect(result.baseline.replay.warm).toHaveLength(1)
    expect(adaptiveCold.wallClockMs).toBeGreaterThan(0)
    expect(adaptiveCold.modelCallMs).toBeGreaterThan(0)
    expect(adaptiveCold.navigationMs).toBeGreaterThan(0)
    expect(adaptiveCold.artifactMs).toBe(0)
    expect(adaptiveWarm.wallClockMs).toBeLessThan(adaptiveCold.wallClockMs)
  })

  test('meets the warm Replay and Adaptive performance gates', async () => {
    const scenarioId = resolveScenarioId(
      specification.source.uri,
      specification.name,
      scenario.name,
      scenario.tags,
    )
    const result = await runWebPerformanceBenchmark({
      selections: [{ specification, scenario }],
      options: { baseUrl: 'https://example.test' },
      plans: planStore(scenarioId),
      delays: {
        launchMs: 120,
        navigationMs: 100,
        modelCallMs: 60,
        artifactMs: 10,
      },
    })

    const gates = evaluatePerformanceGates(result.baseline, result.candidate)
    expect(gates.warmReplayP50.passed).toBe(true)
    expect(gates.adaptiveP95.passed).toBe(true)
    expect(gates.passed).toBe(true)
    expect(gates.warmReplayP50.candidateMs).toBeLessThanOrEqual(
      gates.warmReplayP50.baselineMs * 0.5,
    )
    expect(gates.adaptiveP95.candidateMs).toBeLessThanOrEqual(
      gates.adaptiveP95.baselineMs * 1.1,
    )
  })
})

describe('evaluatePerformanceGates', () => {
  test('fails when warm Replay p50 does not improve by at least fifty percent', () => {
    const evaluation = evaluatePerformanceGates(
      {
        adaptive: {
          cold: [
            {
              wallClockMs: 100,
              modelCallMs: 0,
              navigationMs: 0,
              artifactMs: 0,
            },
          ],
          warm: [
            {
              wallClockMs: 100,
              modelCallMs: 0,
              navigationMs: 0,
              artifactMs: 0,
            },
          ],
        },
        replay: {
          cold: [
            {
              wallClockMs: 200,
              modelCallMs: 0,
              navigationMs: 0,
              artifactMs: 0,
            },
          ],
          warm: [
            {
              wallClockMs: 200,
              modelCallMs: 0,
              navigationMs: 0,
              artifactMs: 0,
            },
          ],
        },
      },
      {
        adaptive: {
          cold: [
            {
              wallClockMs: 100,
              modelCallMs: 0,
              navigationMs: 0,
              artifactMs: 0,
            },
          ],
          warm: [
            {
              wallClockMs: 100,
              modelCallMs: 0,
              navigationMs: 0,
              artifactMs: 0,
            },
          ],
        },
        replay: {
          cold: [
            {
              wallClockMs: 150,
              modelCallMs: 0,
              navigationMs: 0,
              artifactMs: 0,
            },
          ],
          warm: [
            {
              wallClockMs: 150,
              modelCallMs: 0,
              navigationMs: 0,
              artifactMs: 0,
            },
          ],
        },
      },
    )

    expect(evaluation.warmReplayP50.passed).toBe(false)
    expect(evaluation.passed).toBe(false)
  })
})
