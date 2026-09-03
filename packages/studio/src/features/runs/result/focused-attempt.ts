import type { TestResultState, TestStepResult } from '@pickle-spec/runner'
import type { StudioRunSnapshot } from '../../../server/contracts'
import {
  displayedAttemptState,
  isAttemptInProgress,
} from './live-result-inspection'
import {
  artifactsFor,
  defaultResultInspectorTab,
  diagnosticsFor,
  findInspectedResult,
  timelineFor,
} from './result-evidence'
import type {
  ResultInspectionLocation,
  ResultInspectorTab,
} from './result-inspection'
import { timeTravelInspection } from './time-travel-inspection'

export type FocusedAttemptStep = {
  durationMs: number
  index: number
  sourceLine?: number
  state: TestResultState | 'running'
  text: string
}

export type FocusedAttemptProjection = {
  activeTab: ResultInspectorTab
  artifacts: ReturnType<typeof artifactsFor>
  consoleCount: number
  currentStep?: FocusedAttemptStep
  diagnostics: ReturnType<typeof diagnosticsFor>
  displayState: ReturnType<typeof displayedAttemptState>
  inProgress: boolean
  inspected: NonNullable<ReturnType<typeof findInspectedResult>>
  logCount: number
  resultState: TestResultState
  screenshotCount: number
  timeline: ReturnType<typeof timelineFor>
}

function focusedStep(
  step: TestStepResult | undefined,
  inProgress: boolean,
): FocusedAttemptStep | undefined {
  if (!step) return undefined
  return {
    durationMs: step.durationMs,
    index: step.index,
    sourceLine: step.step.source?.line,
    state: inProgress ? 'running' : step.state,
    text: `${step.step.keyword.trim()} ${step.step.text}`,
  }
}

export function focusedAttemptProjection(
  snapshot: StudioRunSnapshot,
  location: ResultInspectionLocation,
): FocusedAttemptProjection | undefined {
  const inspected = findInspectedResult(snapshot, location)
  if (!inspected) return undefined
  const inProgress = isAttemptInProgress(inspected.attempt)
  const displayState = displayedAttemptState(inspected.attempt)
  const resultState =
    displayState === 'running' ? inspected.attempt.state : displayState
  const artifacts = artifactsFor(inspected.attempt)
  const diagnostics = diagnosticsFor(inspected.attempt)
  const actions = timeTravelInspection(snapshot, location)

  return {
    activeTab:
      location.tab ?? defaultResultInspectorTab(inspected.attempt.state),
    artifacts,
    consoleCount: diagnostics.filter((item) => item.origin === 'console')
      .length,
    currentStep: focusedStep(inspected.attempt.steps.at(-1), inProgress),
    diagnostics,
    displayState,
    inProgress,
    inspected,
    logCount: diagnostics.filter(
      (item) => item.origin === 'runner' || item.origin === 'application',
    ).length,
    resultState,
    screenshotCount: artifacts.filter(
      (item) => item.artifact.kind === 'screenshot',
    ).length,
    timeline: timelineFor(
      snapshot.events,
      inspected.attempt,
      location,
      actions,
    ),
  }
}
