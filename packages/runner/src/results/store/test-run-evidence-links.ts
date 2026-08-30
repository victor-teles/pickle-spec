import type {
  RunEvent,
  RunEventPayload,
  RunEventScope,
  TestArtifact,
  TestStepResult,
} from '../../execution/run-scenario'

function sameAttemptScope(
  left: RunEventScope,
  right: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
): boolean {
  return (
    left.scenarioId === right.scenarioId &&
    left.examplesRowId === right.examplesRowId &&
    left.executionTargetProfileId === right.executionTargetProfileId &&
    left.attempt === right.attempt
  )
}

function artifactStartSequence(
  artifact: TestArtifact,
  stepIndex: number,
  scope: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
  current: readonly RunEvent[],
): number | undefined {
  const started = current.filter(
    (event): event is Extract<RunEvent, { type: 'step-started' }> =>
      event.type === 'step-started' && sameAttemptScope(event.scope, scope),
  )
  if (artifact.kind === 'recording') return started[0]?.sequence
  return started.findLast((event) => event.scope.stepIndex === stepIndex)
    ?.sequence
}

export function stampArtifactEvidenceLinks(
  step: TestStepResult,
  scope: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
  current: readonly RunEvent[],
  endSequence: number,
): TestStepResult {
  if (!step.artifacts?.length) return step
  return {
    ...step,
    artifacts: step.artifacts.map((artifact) => {
      const startSequence = artifactStartSequence(
        artifact,
        step.index,
        scope,
        current,
      )
      if (startSequence === undefined) return artifact
      return {
        ...artifact,
        evidenceLink: {
          stepIndex: step.index,
          eventRange: { startSequence, endSequence },
        },
      }
    }),
  }
}

export function matchingStepFinishedSequence(
  current: readonly RunEvent[],
  scope: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
): number | undefined {
  return current.findLast(
    (event) => event.type === 'step-finished' && sameScope(event.scope, scope),
  )?.sequence
}

export function sameScope(
  left: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
  right: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
): boolean {
  return (
    left.scenarioId === right.scenarioId &&
    left.examplesRowId === right.examplesRowId &&
    left.executionTargetProfileId === right.executionTargetProfileId &&
    left.attempt === right.attempt &&
    left.stepIndex === right.stepIndex
  )
}
