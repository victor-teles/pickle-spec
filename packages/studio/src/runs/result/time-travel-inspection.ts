import type { ActionEvidence, RunEventScope } from '@pickle-spec/runner'
import type { StudioRunSnapshot } from '../../server/server'
import { findInspectedResult } from './result-evidence'
import type { ResultInspectionLocation } from './result-inspection'

export type TimeTravelAction = {
  key: string
  scope: RunEventScope
  stepText: string
  precision: 'exact' | 'legacy-step-finish'
  ordinal: number
  description: string
  evidence?: ActionEvidence
  retries: Array<{
    attempt: number
    state: ActionEvidence['state']
    current: boolean
  }>
}

function matchesLocation(
  scope: RunEventScope,
  location: ResultInspectionLocation,
): boolean {
  return (
    scope.scenarioId === location.scenarioId &&
    scope.examplesRowId === location.examplesRowId &&
    scope.executionTargetProfileId === location.profileId &&
    scope.attempt === location.attempt
  )
}

function actionKey(stepIndex: number, id: string): string {
  return `${stepIndex}:${id}`
}

export function timeTravelInspection(
  snapshot: StudioRunSnapshot,
  location: ResultInspectionLocation,
): TimeTravelAction[] {
  const exact = liveActions(snapshot, location)
  addCompletedActions(exact, snapshot, location)
  return [...exact.values()]
    .map((action) => ({
      ...action,
      retries: actionRetries(snapshot, location, action),
    }))
    .sort(
      (left, right) =>
        (left.scope.stepIndex ?? 0) - (right.scope.stepIndex ?? 0) ||
        (left.evidence?.ordinal ?? 0) - (right.evidence?.ordinal ?? 0),
    )
}

function actionRetries(
  snapshot: StudioRunSnapshot,
  location: ResultInspectionLocation,
  action: TimeTravelAction,
): TimeTravelAction['retries'] {
  const attempts = new Map<number, ActionEvidence['state']>()
  const stepIndex = action.scope.stepIndex ?? 0
  addLiveRetries(attempts, snapshot, location, action, stepIndex)
  addCompletedRetries(attempts, snapshot, location, action, stepIndex)
  if (action.evidence) attempts.set(location.attempt, action.evidence.state)
  return [...attempts]
    .sort(([left], [right]) => left - right)
    .map(([attempt, state]) => ({
      attempt,
      state,
      current: attempt === location.attempt,
    }))
}

function addLiveRetries(
  attempts: Map<number, ActionEvidence['state']>,
  snapshot: StudioRunSnapshot,
  location: ResultInspectionLocation,
  action: TimeTravelAction,
  stepIndex: number,
): void {
  for (const event of snapshot.events) {
    if (event.type !== 'action-finished') continue
    if (
      event.scope.scenarioId !== location.scenarioId ||
      event.scope.examplesRowId !== location.examplesRowId ||
      event.scope.executionTargetProfileId !== location.profileId ||
      event.scope.stepIndex !== stepIndex ||
      event.action.id !== action.evidence?.id
    ) {
      continue
    }
    attempts.set(event.scope.attempt, event.action.state)
  }
}

function addCompletedRetries(
  attempts: Map<number, ActionEvidence['state']>,
  snapshot: StudioRunSnapshot,
  location: ResultInspectionLocation,
  action: TimeTravelAction,
  stepIndex: number,
): void {
  const result = findInspectedResult(snapshot, location)?.result
  for (const attempt of result?.attempts ?? []) {
    const step = attempt.steps.find(
      (candidate) => candidate.index === stepIndex,
    )
    const resolved = step?.resolvedActions.find(
      (candidate, ordinal) =>
        (action.evidence !== undefined &&
          candidate.evidence?.id === action.evidence.id) ||
        (action.evidence === undefined && ordinal === action.ordinal),
    )
    if (resolved?.evidence)
      attempts.set(attempt.attempt, resolved.evidence.state)
  }
}

function liveActions(
  snapshot: StudioRunSnapshot,
  location: ResultInspectionLocation,
): Map<string, TimeTravelAction> {
  const exact = new Map<string, TimeTravelAction>()
  for (const event of snapshot.events) {
    if (event.type !== 'action-finished') continue
    if (!matchesLocation(event.scope, location)) continue
    const stepIndex = event.scope.stepIndex ?? 0
    exact.set(actionKey(stepIndex, event.action.id), {
      key: actionKey(stepIndex, event.action.id),
      scope: event.scope,
      stepText: event.action.source.excerpt,
      precision: 'exact',
      ordinal: event.action.ordinal,
      description: event.action.description,
      evidence: event.action,
      retries: [],
    })
  }
  return exact
}

function addCompletedActions(
  exact: Map<string, TimeTravelAction>,
  snapshot: StudioRunSnapshot,
  location: ResultInspectionLocation,
): void {
  const inspected = findInspectedResult(snapshot, location)
  for (const step of inspected?.attempt.steps ?? []) {
    for (const [ordinal, action] of step.resolvedActions.entries()) {
      const id = action.evidence?.id ?? `legacy-action-${ordinal + 1}`
      const key = actionKey(step.index, id)
      const scope: RunEventScope = {
        scenarioId: location.scenarioId,
        examplesRowId: location.examplesRowId,
        executionTargetProfileId: location.profileId,
        attempt: location.attempt,
        stepIndex: step.index,
      }
      exact.set(key, {
        key,
        scope,
        stepText: `${step.step.keyword.trim()} ${step.step.text}`,
        precision: action.evidence ? 'exact' : 'legacy-step-finish',
        ordinal: action.evidence?.ordinal ?? ordinal,
        description: action.description,
        evidence: action.evidence,
        retries: [],
      })
    }
  }
}
