import { useEffect, useState } from 'react'
import { studioApi, studioToken } from '../../lib/studio-api'
import { startedRunSchema } from '../runs/run.schemas'
import { getStudioRuns } from '../runs/runs.functions'
import type {
  StudioPlanValidationInspection,
  StudioPlanValidationStatus,
} from './execution-plan.contracts'
import {
  getPlanValidationStatus,
  inspectPlanValidation,
  reviewPlanValidation,
} from './validation.functions'

type ValidationState =
  | { phase: 'draft' | 'loading' | 'starting' }
  | { phase: 'review'; inspection: StudioPlanValidationInspection }
  | { phase: 'running'; runId: string; reviewId: string }
  | {
      phase: 'complete'
      status: Exclude<StudioPlanValidationStatus, { state: 'draft' }>
    }
  | { phase: 'error'; message: string; runId?: string }

export function usePlanValidation(revisionId: string) {
  const [state, setState] = useState<ValidationState>({ phase: 'draft' })
  const running = state.phase === 'running' ? state : undefined
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      if (!running) return
      const { runId, reviewId } = running
      try {
        const runs = await getStudioRuns()
        const result = await getPlanValidationStatus({
          data: { revisionId, reviewId },
        })
        if (stopped) return
        if (!result.ok) {
          setState({ phase: 'error', message: result.message, runId })
          return
        }
        if (result.value.state !== 'draft' && result.value.runId === runId) {
          setState({ phase: 'complete', status: result.value })
          return
        }
        if (!runs.activeRunIds.includes(runId)) {
          setState({
            phase: 'error',
            message:
              'The run finished without an available validation receipt. Check its evidence in Runs before trying again.',
            runId,
          })
          return
        }
        timer = setTimeout(() => void poll(), 1000)
      } catch {
        if (!stopped)
          setState({
            phase: 'error',
            message:
              'Could not retrieve validation status. Check this run in Runs.',
            runId,
          })
      }
    }
    if (running) void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [revisionId, running])

  async function inspect() {
    setState({ phase: 'loading' })
    try {
      const result = await inspectPlanValidation({ data: { revisionId } })
      setState(
        result.ok
          ? { phase: 'review', inspection: result.value }
          : { phase: 'error', message: result.message },
      )
    } catch {
      setState({
        phase: 'error',
        message:
          'Could not inspect this candidate. Check the connection and try again.',
      })
    }
  }

  async function validate(rationale: string) {
    setState({ phase: 'starting' })
    try {
      const review = await reviewPlanValidation({
        data: { revisionId, rationale, evidenceRunIds: [] },
      })
      if (!review.ok) {
        setState({ phase: 'error', message: review.message })
        return
      }
      const started = await studioApi('/api/runs', startedRunSchema, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planValidation: {
            revisionId,
            reviewId: review.value.reviewId,
            resetConfirmed: true,
          },
        }),
      })
      setState({
        phase: 'running',
        runId: started.id,
        reviewId: review.value.reviewId,
      })
    } catch {
      setState({
        phase: 'error',
        message:
          'Could not start validation. Review the current project configuration and try again.',
      })
    }
  }

  async function cancel() {
    if (state.phase !== 'running') return
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(state.runId)}/cancel`,
        { method: 'POST', headers: { Authorization: `Bearer ${studioToken}` } },
      )
      if (!response.ok) throw new Error(await response.text())
    } catch {
      setState({
        phase: 'error',
        message: 'Cancellation could not be confirmed. Check this run in Runs.',
        runId: state.runId,
      })
    }
  }

  return { state, inspect, validate, cancel }
}
