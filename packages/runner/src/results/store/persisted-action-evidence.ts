import { join } from 'node:path'
import type {
  RunEvent,
  RunEventPayload,
  TestArtifact,
  TestStepResult,
} from '../../execution/run-scenario'
import {
  copyStepArtifacts,
  withoutProvisionalActionEvidence,
} from './test-run-artifacts'
import type { EvidencePersistencePolicy } from './test-run-evidence'
import { sameScope } from './test-run-evidence-links'

export type PersistedEventEvidence = {
  event: RunEventPayload
  publishedPaths: string[]
}

type PersistedActionArtifacts = {
  action: Extract<RunEventPayload, { type: 'action-finished' }>['action']
  publishedPaths: string[]
}

export function withPersistedActionArtifacts(
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

export async function persistActionEventArtifacts(
  event: Extract<RunEventPayload, { type: 'action-finished' }>,
  policy: EvidencePersistencePolicy,
  artifactsDirectory: string,
  stepName: string,
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
  const persisted = await persistActionArtifacts(
    event,
    artifactsDirectory,
    stepName,
  )
  return {
    event: { ...event, action: persisted.action },
    publishedPaths: persisted.publishedPaths,
  }
}

async function persistActionArtifacts(
  event: Extract<RunEventPayload, { type: 'action-finished' }>,
  artifactsDirectory: string,
  stepName: string,
): Promise<PersistedActionArtifacts> {
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
    join(stepName, `action-${event.action.ordinal}`),
  )
  const action = persisted.step.resolvedActions[0]?.evidence
  return {
    action: action ?? withoutProvisionalActionEvidence(event.action),
    publishedPaths: persisted.publishedPaths,
  }
}
