import type { ExecutionPlanDraftDisplay } from '@pickle-spec/runner'
import { describe, expect, test } from 'vitest'
import type {
  StudioExecutionPlanDraftResult,
  StudioExecutionPlanRequest,
} from '../../../src/features/execution-plans/execution-plan.contracts'
import {
  captureDraft,
  type ExecutionPlanDraftState,
} from '../../../src/features/execution-plans/execution-plan-panel'

const request: StudioExecutionPlanRequest = {
  scenarioId: 'scenario-1',
  profileId: 'browser',
}

function draftState(): ExecutionPlanDraftState & {
  events: string[]
} {
  const events: string[] = []
  return {
    events,
    capturing: false,
    setDraft: () => events.push('draft'),
    setCaptureError: (value) => events.push(value ? `error:${value}` : 'clear'),
    setCapturing: (value) => events.push(value ? 'capturing' : 'idle'),
    discard: () => undefined,
  }
}

describe('execution plan capture action', () => {
  test('starts the draft and clears the loading state when capture succeeds', async () => {
    const state = draftState()
    const capturedDraft = {} as ExecutionPlanDraftDisplay
    const capture = async (): Promise<StudioExecutionPlanDraftResult> => ({
      ok: true,
      value: capturedDraft,
    })

    await captureDraft(request, state, capture)

    expect(state.events).toEqual(['clear', 'capturing', 'draft', 'idle'])
  })

  test('surfaces a rejected or thrown capture instead of appearing inert', async () => {
    const rejectedState = draftState()
    const rejectedCapture =
      async (): Promise<StudioExecutionPlanDraftResult> => ({
        ok: false,
        reason: 'incomplete-plan',
        message: 'The cached plan is incomplete.',
      })

    await captureDraft(request, rejectedState, rejectedCapture)
    expect(rejectedState.events).toEqual([
      'clear',
      'capturing',
      'error:The cached plan is incomplete.',
      'idle',
    ])

    const thrownState = draftState()
    await captureDraft(request, thrownState, async () => {
      throw new Error('transport failed')
    })
    expect(thrownState.events).toEqual([
      'clear',
      'capturing',
      'error:Unable to start the draft. Check the project and try again.',
      'idle',
    ])
  })
})
