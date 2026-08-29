import type { Scenario, Specification } from '@pickle-spec/spec'
import { describe, expect, test } from 'vitest'
import type {
  ExecutionTargetAdapter,
  ExecutionTargetProfile,
  RunEvent,
  TestResultState,
} from './index'
import { runScenario } from './index'
import { finalScenarioAttempt } from './src/execution/run-scenario-types'

export interface AdapterConformanceSuiteOptions {
  name: string
  createAdapter(): ExecutionTargetAdapter
  executionTargetProfile: ExecutionTargetProfile
  specification: Specification
  scenario: Scenario
  expectedCapabilities: readonly string[]
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
        ).toEqual(run.events.map((_, index) => [2, index + 1]))
        expect(run.result).toMatchObject({
          schemaVersion: 2,
          state: options.expectedAdaptiveState ?? 'passed',
          executionTargetProfile: options.executionTargetProfile,
        })
        const attempt = finalScenarioAttempt(run.result)
        expect(attempt.executionMode).toBe('adaptive')
        expect(attempt.steps).toHaveLength(options.scenario.steps.length)
      } finally {
        await adapter.dispose?.()
      }
    })
  })
}
