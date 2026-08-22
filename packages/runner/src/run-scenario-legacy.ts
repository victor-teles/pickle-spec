import { scenarioRevision } from '@pickle-spec/spec'
import {
  type ExecutionPlan,
  type PlanApplicability,
  planApplies,
} from './execution-plan'
import { runScenarioAttempt, withAttemptMetadata } from './run-scenario'
import type {
  RunEvent,
  RunScenarioInput,
  ScenarioRun,
  TestResultState,
  TestStepResult,
} from './run-scenario-types'
import { createScenarioRetryTracker } from './scenario-retry'
import { scenarioDefinitionId } from './scenario-runtime'

function planQuery(input: RunScenarioInput): PlanApplicability {
  return {
    scenarioId: scenarioDefinitionId(input.specification, input.scenario),
    scenarioRevision: scenarioRevision(input.scenario),
    executionTargetProfileId: input.executionTargetProfile.id,
    planFormatVersion: input.adapter.planFormatVersion ?? '1',
    applicationRevision: input.applicationRevision,
  }
}

async function selectPlan(input: RunScenarioInput): Promise<{
  mode: 'adaptive' | 'replay'
  plan?: ExecutionPlan
  query: PlanApplicability
}> {
  const query = planQuery(input)
  const found = await input.plans?.findApproved(query)
  const plan = found && planApplies(found, query) ? found : undefined
  if (plan && input.applicationRevision === undefined && input.ci) {
    throw new Error(
      'CI Replay requires applicationRevision. Set applicationRevision or --application-revision.',
    )
  }
  return {
    mode: plan ? 'replay' : 'adaptive',
    plan,
    query,
  }
}

function candidatePlan(
  query: PlanApplicability,
  steps: TestStepResult[],
): ExecutionPlan {
  return {
    schemaVersion: 1,
    ...query,
    steps: steps.map((step) => ({ resolvedActions: step.resolvedActions })),
  }
}

function shouldSaveCandidate(
  state: TestResultState,
  mode: 'adaptive' | 'replay',
): boolean {
  return (
    state === 'passed-with-adaptation' ||
    (state === 'passed' && mode === 'adaptive')
  )
}

export async function runLegacyScenario(
  input: RunScenarioInput,
): Promise<ScenarioRun> {
  const events: RunEvent[] = []
  const retries = createScenarioRetryTracker(input.retry)
  const selected = await selectPlan(input)

  for (let attempt = 1; ; attempt++) {
    const run = await runScenarioAttempt({
      ...input,
      mode: selected.mode,
      plan: selected.plan,
      onEvent: async (event) => {
        if (event.type === 'scenario-finished') return
        const versionedEvent = {
          ...event,
          sequence: events.length + 1,
        } as RunEvent
        events.push(versionedEvent)
        await input.onEvent?.(versionedEvent)
      },
      retry: undefined,
    })
    const shouldRetry = retries.shouldRetry({
      state: run.result.state,
      aborted: Boolean(input.signal?.aborted),
    })
    const result = withAttemptMetadata(run.result, attempt)

    for (const event of run.events) {
      if (event.type !== 'scenario-finished') continue
      const versionedEvent = {
        ...event,
        sequence: events.length + 1,
        result: shouldRetry ? event.result : result,
      } as RunEvent
      events.push(versionedEvent)
      await input.onEvent?.(versionedEvent)
    }

    if (shouldRetry) continue
    if (input.plans && shouldSaveCandidate(result.state, selected.mode)) {
      await input.plans.saveCandidate(
        candidatePlan(selected.query, result.steps),
      )
    }
    return { events, result }
  }
}
