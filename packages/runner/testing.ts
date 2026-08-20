import { describe, expect, test } from 'bun:test'
import type { Scenario, Specification } from '@pickle-spec/spec'
import type {
  ExecutionTargetAdapter,
  ExecutionTargetProfile,
  ResolvedAction,
  RunEvent,
  TestResultState,
} from './index'
import { runScenario } from './index'

export interface AdapterConformanceSuiteOptions {
  name: string
  createAdapter(): ExecutionTargetAdapter
  executionTargetProfile: ExecutionTargetProfile
  specification: Specification
  scenario: Scenario
  expectedCapabilities: readonly string[]
  replayActions: readonly (readonly ResolvedAction[])[]
  expectedAdaptiveState?: TestResultState
}

function expectedEventTypes(stepCount: number): RunEvent['type'][] {
  const eventTypes: RunEvent['type'][] = ['scenario-started']
  for (let index = 0; index < stepCount; index++) {
    eventTypes.push('step-started', 'step-finished')
  }
  eventTypes.push('scenario-finished')
  return eventTypes
}

export function defineAdapterConformanceSuite(
  options: AdapterConformanceSuiteOptions,
): void {
  describe(`${options.name} adapter conformance`, () => {
    test('produces common Adaptive run events and a test result', async () => {
      const adapter = options.createAdapter()
      try {
        expect(adapter.capabilities).toEqual(options.expectedCapabilities)
        const run = await runScenario({
          specification: options.specification,
          scenario: options.scenario,
          executionTargetProfile: options.executionTargetProfile,
          adapter,
        })

        expect(run.events.map((event) => event.type)).toEqual(
          expectedEventTypes(options.scenario.steps.length),
        )
        expect(
          run.events.map((event) => [event.schemaVersion, event.sequence]),
        ).toEqual(run.events.map((_, index) => [1, index + 1]))
        expect(run.result).toMatchObject({
          schemaVersion: 1,
          state: options.expectedAdaptiveState ?? 'passed',
          executionMode: 'adaptive',
          executionTargetProfile: options.executionTargetProfile,
        })
        expect(run.result.steps).toHaveLength(options.scenario.steps.length)
      } finally {
        await adapter.dispose?.()
      }
    })

    test('produces common Replay run events and a test result', async () => {
      const adapter = options.createAdapter()
      try {
        const run = await runScenario({
          specification: options.specification,
          scenario: options.scenario,
          executionTargetProfile: options.executionTargetProfile,
          adapter,
          plans: {
            async findApproved(query) {
              return {
                schemaVersion: 1,
                ...query,
                steps: options.replayActions.map((resolvedActions) => ({
                  resolvedActions: [...resolvedActions],
                })),
              }
            },
            async saveCandidate() {
              throw new Error('Replay must not save a candidate plan')
            },
          },
        })

        expect(run.events.map((event) => event.type)).toEqual(
          expectedEventTypes(options.scenario.steps.length),
        )
        expect(run.result).toMatchObject({
          schemaVersion: 1,
          state: 'passed',
          executionMode: 'replay',
          executionTargetProfile: options.executionTargetProfile,
        })
        expect(run.result.steps.map((step) => step.resolvedActions)).toEqual(
          options.replayActions.map((resolvedActions) => [...resolvedActions]),
        )
      } finally {
        await adapter.dispose?.()
      }
    })
  })
}
