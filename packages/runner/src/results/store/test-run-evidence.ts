import { join } from 'node:path'
import type {
  RunEvent,
  RunEventPayload,
  ScenarioAttempt,
  TestArtifact,
  TestResultState,
  TestStepResult,
} from '../../execution/run-scenario'
import type { PersistedStepEvidence } from './test-run-artifacts'
import {
  artifactDestination,
  copyStepArtifacts,
  mapActionEvidenceArtifacts,
  slug,
  withoutAttemptEvidence,
  withoutProvisionalActionEvidence,
  withoutStepEvidence,
} from './test-run-artifacts'
import {
  matchingStepFinishedSequence,
  sameScope,
  stampArtifactEvidenceLinks,
} from './test-run-evidence-links'

export type EvidencePersistencePolicy = 'off' | 'on-failure' | 'always'
export type ArtifactCapturePolicy = EvidencePersistencePolicy

export async function persistEventArtifacts(
  event: RunEventPayload,
  current: readonly RunEvent[],
  policy: EvidencePersistencePolicy,
  artifactsDirectory: string,
  endSequence: number,
): Promise<PersistedEventEvidence> {
  if (event.type === 'action-finished') {
    return persistActionEventArtifacts(event, policy, artifactsDirectory)
  }
  if (event.type === 'scenario-finished') {
    const persisted = await persistAttemptArtifacts(
      event.attempt,
      event.scope,
      current,
      policy,
      artifactsDirectory,
    )
    return {
      event: {
        ...event,
        attempt: {
          ...persisted.attempt,
          steps: persisted.attempt.steps.map((step) =>
            stampArtifactEvidenceLinks(
              step,
              { ...event.scope, stepIndex: step.index },
              current,
              matchingStepFinishedSequence(current, {
                ...event.scope,
                stepIndex: step.index,
              }) ?? endSequence,
            ),
          ),
        },
      },
      publishedPaths: persisted.publishedPaths,
    }
  }
  if (event.type === 'step-finished') {
    const step = withPersistedActionArtifacts(
      event.result,
      event.scope,
      current,
    )
    const persisted = await persistStepArtifacts(
      step,
      policy,
      artifactsDirectory,
      artifactStepName(event.scope, event.result.index),
    )
    return {
      event: {
        ...event,
        result: stampArtifactEvidenceLinks(
          persisted.step,
          event.scope,
          current,
          endSequence,
        ),
      },
      publishedPaths: persisted.publishedPaths,
    }
  }
  return { event, publishedPaths: [] }
}

function withPersistedActionArtifacts(
  step: TestStepResult,
  scope: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
  current: readonly RunEvent[],
): TestStepResult {
  const artifactsBySourcePath = new Map<string, TestArtifact>()
  const resolvedActions = step.resolvedActions.map((resolvedAction) => {
    const evidence = resolvedAction.evidence
    if (!evidence) return resolvedAction
    const persisted = current.findLast(
      (event) =>
        event.type === 'action-finished' &&
        sameScope(event.scope, scope) &&
        event.action.id === evidence.id,
    )
    if (persisted?.type !== 'action-finished') return resolvedAction
    const screenshot = (
      source: typeof evidence.screenshots.before,
      retained: typeof evidence.screenshots.before,
    ): typeof evidence.screenshots.before => {
      if (source.state !== 'available' || retained.state !== 'available') {
        return retained
      }
      artifactsBySourcePath.set(source.artifact.path, retained.artifact)
      return retained
    }
    return {
      ...resolvedAction,
      evidence: {
        ...evidence,
        screenshots: {
          before: screenshot(
            evidence.screenshots.before,
            persisted.action.screenshots.before,
          ),
          after: screenshot(
            evidence.screenshots.after,
            persisted.action.screenshots.after,
          ),
        },
      },
    }
  })
  return {
    ...step,
    resolvedActions,
    artifacts: step.artifacts?.map(
      (artifact) => artifactsBySourcePath.get(artifact.path) ?? artifact,
    ),
  }
}

async function persistActionEventArtifacts(
  event: Extract<RunEventPayload, { type: 'action-finished' }>,
  policy: EvidencePersistencePolicy,
  artifactsDirectory: string,
): Promise<PersistedEventEvidence> {
  if (policy !== 'always') {
    return {
      event: {
        ...event,
        action: withoutProvisionalActionEvidence(event.action),
      },
      publishedPaths: [],
    }
  }
  const persisted = await persistActionArtifacts(event, artifactsDirectory)
  return {
    event: { ...event, action: persisted.action },
    publishedPaths: persisted.publishedPaths,
  }
}

async function persistActionArtifacts(
  event: Extract<RunEventPayload, { type: 'action-finished' }>,
  artifactsDirectory: string,
): Promise<{
  action: typeof event.action
  publishedPaths: string[]
}> {
  const artifacts = [
    event.action.screenshots.before,
    event.action.screenshots.after,
  ].flatMap((screenshot) =>
    screenshot.state === 'available' ? [screenshot.artifact] : [],
  )
  const syntheticStep: TestStepResult = {
    index: event.scope.stepIndex ?? 0,
    startedAt: event.action.startedAt,
    finishedAt: event.action.finishedAt,
    durationMs: event.action.durationMs,
    step: {
      keyword: 'When',
      text: event.action.description,
      type: 'action',
    },
    state: event.action.state,
    resolvedActions: [
      { description: event.action.description, evidence: event.action },
    ],
    artifacts,
  }
  const persisted = await copyStepArtifacts(
    syntheticStep,
    artifactsDirectory,
    join(
      artifactStepName(event.scope, event.scope.stepIndex ?? 0),
      `action-${event.action.ordinal}`,
    ),
  )
  const action = persisted.step.resolvedActions[0]?.evidence
  return {
    action: action ?? withoutProvisionalActionEvidence(event.action),
    publishedPaths: persisted.publishedPaths,
  }
}

type PersistedEventEvidence = {
  event: RunEventPayload
  publishedPaths: string[]
}

type PersistedAttemptEvidence = {
  attempt: ScenarioAttempt
  publishedPaths: string[]
}

async function persistAttemptStep(
  step: TestStepResult,
  scope: Extract<RunEventPayload, { type: 'scenario-finished' }>['scope'],
  current: readonly RunEvent[],
  artifactsDirectory: string,
): Promise<PersistedStepEvidence> {
  const stepScope = { ...scope, stepIndex: step.index }
  const currentStep = withPersistedActionArtifacts(step, stepScope, current)
  const persisted = current.findLast(
    (event) =>
      event.type === 'step-finished' && sameScope(event.scope, stepScope),
  )
  const stepName = artifactStepName(scope, step.index)
  if (persisted?.type !== 'step-finished' || !persisted.result.artifacts) {
    return copyStepArtifacts(currentStep, artifactsDirectory, stepName)
  }
  if (persisted.result.artifacts.length === currentStep.artifacts?.length) {
    const copiedBySourcePath = new Map(
      (currentStep.artifacts ?? []).flatMap((artifact, index) => {
        const persistedArtifact = persisted.result.artifacts?.[index]
        return persistedArtifact ? [[artifact.path, persistedArtifact]] : []
      }),
    )
    return {
      step: {
        ...mapActionEvidenceArtifacts(currentStep, copiedBySourcePath),
        artifacts: persisted.result.artifacts,
      },
      publishedPaths: [],
      captureFailures: [],
    }
  }
  const artifacts = currentStep.artifacts?.map((artifact, index) => {
    const path = artifactDestination(
      artifact,
      index,
      artifactsDirectory,
      stepName,
    )
    return (
      persisted.result.artifacts?.find(
        (committed) => committed.path === path,
      ) ?? artifact
    )
  })
  return copyStepArtifacts(
    { ...currentStep, artifacts },
    artifactsDirectory,
    stepName,
  )
}

async function persistAttemptArtifacts(
  attempt: ScenarioAttempt,
  scope: Extract<RunEventPayload, { type: 'scenario-finished' }>['scope'],
  current: readonly RunEvent[],
  policy: EvidencePersistencePolicy,
  artifactsDirectory: string,
): Promise<PersistedAttemptEvidence> {
  if (!shouldPersistEvidence(policy, attempt.state)) {
    return { attempt: withoutAttemptEvidence(attempt), publishedPaths: [] }
  }
  const steps = await Promise.all(
    attempt.steps.map((step) =>
      persistAttemptStep(step, scope, current, artifactsDirectory),
    ),
  )
  const captureFailures = steps.flatMap((step) => step.captureFailures)
  return {
    attempt: {
      ...attempt,
      steps: steps.map((step) => step.step),
      evidenceAvailability: attempt.evidenceAvailability.map((availability) => {
        const failures = captureFailures.filter(
          (failure) => failure.kind === availability.kind,
        )
        return failures.length > 0
          ? {
              ...availability,
              state: 'capture-failed' as const,
              message: failures.map((failure) => failure.message).join('; '),
            }
          : availability
      }),
    },
    publishedPaths: steps.flatMap((step) => step.publishedPaths),
  }
}

function artifactStepName(
  scope: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
  stepIndex: number,
): string {
  return join(
    slug(scope.scenarioId),
    ...(scope.examplesRowId
      ? [`examples-row-${slug(scope.examplesRowId)}`]
      : []),
    slug(scope.executionTargetProfileId),
    `attempt-${scope.attempt}`,
    `step-${stepIndex + 1}`,
  )
}

async function persistStepArtifacts(
  step: TestStepResult,
  policy: EvidencePersistencePolicy,
  artifactsDirectory: string,
  name: string,
): Promise<PersistedStepEvidence> {
  if (!shouldPersistEvidence(policy, step.state)) {
    return {
      step: withoutStepEvidence(step),
      publishedPaths: [],
      captureFailures: [],
    }
  }
  if (!step.artifacts?.length) {
    return { step, publishedPaths: [], captureFailures: [] }
  }
  return copyStepArtifacts(step, artifactsDirectory, name)
}

function shouldPersistEvidence(
  policy: EvidencePersistencePolicy,
  state: TestResultState,
): boolean {
  if (policy === 'always') return true
  if (policy === 'off') return false
  return state === 'failed' || state === 'infrastructure-error'
}

export function shouldPersistEventEvidence(
  event: RunEventPayload,
  policy: EvidencePersistencePolicy,
): boolean {
  if (event.type === 'action-finished') return policy === 'always'
  if (event.type === 'step-finished') {
    return shouldPersistEvidence(policy, event.result.state)
  }
  if (event.type === 'scenario-finished') {
    return shouldPersistEvidence(policy, event.attempt.state)
  }
  return true
}
