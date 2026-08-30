import { relative, resolve, sep } from 'node:path'
import type {
  RunEvent,
  ScenarioAttempt,
  TestArtifact,
  TestResult,
  TestStepResult,
} from '../../execution/run-scenario'
import {
  publicRunEvent,
  recordableTestResult,
  withoutPrivateStepResultData,
} from '../../results/public-results'
import type { TestRunManifest } from '../../results/test-run-store'
import type { RunArchive } from '../archive'

interface CollectedArtifact {
  absolutePath: string
  archivePath: string
  mediaType?: string
}

type MapArtifactPath = (path: string) => string

export function collectArtifacts(
  manifest: TestRunManifest,
  events: readonly RunEvent[],
  runDirectory: string,
): CollectedArtifact[] {
  const byAbsolute = new Map<string, CollectedArtifact>()
  for (const artifact of artifactReferences(manifest, events)) {
    const absolutePath = resolve(artifact.path)
    if (byAbsolute.has(absolutePath)) continue
    byAbsolute.set(absolutePath, {
      absolutePath,
      archivePath: containedArtifactPath(runDirectory, absolutePath),
      mediaType: artifact.mediaType,
    })
  }
  return [...byAbsolute.values()]
}

function artifactReferences(
  manifest: TestRunManifest,
  events: readonly RunEvent[],
): TestArtifact[] {
  const artifacts: TestArtifact[] = []
  const collectSteps = (steps: readonly TestStepResult[]) => {
    for (const step of steps) artifacts.push(...(step.artifacts ?? []))
  }
  for (const result of manifest.results) {
    for (const attempt of result.attempts) collectSteps(attempt.steps)
  }
  for (const event of events) artifacts.push(...eventArtifactReferences(event))
  return artifacts
}

function eventArtifactReferences(event: RunEvent): TestArtifact[] {
  if (event.type === 'scenario-finished') {
    return event.attempt.steps.flatMap((step) => step.artifacts ?? [])
  }
  if (event.type === 'step-finished') return event.result.artifacts ?? []
  if (event.type !== 'action-finished') return []
  return [
    event.action.screenshots.before,
    event.action.screenshots.after,
  ].flatMap((screenshot) =>
    screenshot.state === 'available' ? [screenshot.artifact] : [],
  )
}

function mapAttemptArtifacts(
  attempt: ScenarioAttempt,
  mapPath: MapArtifactPath,
): ScenarioAttempt {
  return {
    ...attempt,
    steps: attempt.steps.map((step) => mapStepArtifacts(step, mapPath)),
  }
}

function mapStepArtifacts(
  step: TestStepResult,
  mapPath: MapArtifactPath,
): TestStepResult {
  const publicStep = withoutPrivateStepResultData(step)
  return {
    ...publicStep,
    resolvedActions: publicStep.resolvedActions.map((action) => {
      if (!action.evidence) return action
      const screenshot = (
        value: typeof action.evidence.screenshots.before,
      ): typeof action.evidence.screenshots.before =>
        value.state === 'available'
          ? {
              state: 'available',
              artifact: {
                ...value.artifact,
                path: mapPath(value.artifact.path),
              },
            }
          : value
      return {
        ...action,
        evidence: {
          ...action.evidence,
          screenshots: {
            before: screenshot(action.evidence.screenshots.before),
            after: screenshot(action.evidence.screenshots.after),
          },
        },
      }
    }),
    artifacts: publicStep.artifacts?.map((artifact) => ({
      ...artifact,
      path: mapPath(artifact.path),
    })),
  }
}

export function mapResultArtifacts(
  result: TestResult,
  mapPath: MapArtifactPath,
): TestResult {
  const recordable = recordableTestResult(result)
  return {
    ...recordable,
    attempts: recordable.attempts.map((attempt) =>
      mapAttemptArtifacts(attempt, mapPath),
    ),
  }
}

export function mapEventArtifacts(
  event: RunEvent,
  mapPath: MapArtifactPath,
): RunEvent {
  if (event.type === 'scenario-finished') {
    return publicRunEvent({
      ...event,
      attempt: mapAttemptArtifacts(event.attempt, mapPath),
    })
  }
  if (event.type === 'step-finished') {
    return publicRunEvent({
      ...event,
      result: mapStepArtifacts(event.result, mapPath),
    })
  }
  if (event.type === 'action-finished') {
    const screenshot = (
      value: typeof event.action.screenshots.before,
    ): typeof event.action.screenshots.before =>
      value.state === 'available'
        ? {
            state: 'available',
            artifact: {
              ...value.artifact,
              path: mapPath(value.artifact.path),
            },
          }
        : value
    return publicRunEvent({
      ...event,
      action: {
        ...event.action,
        screenshots: {
          before: screenshot(event.action.screenshots.before),
          after: screenshot(event.action.screenshots.after),
        },
      },
    })
  }
  return publicRunEvent(event)
}

export function assertArchiveArtifactPayloads(archive: RunArchive): void {
  const references = new Set(
    artifactReferences(archive.manifest, archive.events).map(
      (artifact) => artifact.path,
    ),
  )
  const payloadCounts = new Map<string, number>()
  for (const artifact of archive.artifacts) {
    payloadCounts.set(
      artifact.path,
      (payloadCounts.get(artifact.path) ?? 0) + 1,
    )
  }
  for (const path of references) {
    if (payloadCounts.get(path) !== 1) {
      throw new Error(
        `Artifact reference "${path}" requires exactly one embedded payload`,
      )
    }
  }
  for (const artifact of archive.artifacts) {
    if (!references.has(artifact.path)) {
      throw new Error(
        `Embedded artifact payload "${artifact.path}" has no manifest or event reference`,
      )
    }
    decodeBase64(artifact.content, artifact.path)
  }
}

export function decodeBase64(content: string, path: string): Uint8Array {
  const base64Pattern =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
  if (content.length % 4 !== 0 || !base64Pattern.test(content)) {
    throw new Error(`Artifact payload "${path}" must be valid base64`)
  }
  const decoded = Buffer.from(content, 'base64')
  if (decoded.toString('base64') !== content) {
    throw new Error(`Artifact payload "${path}" must be valid base64`)
  }
  return decoded
}

export function importedArtifactPath(
  runDirectory: string,
  path: string,
): string {
  const artifactsDirectory = resolve(runDirectory, 'artifacts')
  const target = resolve(runDirectory, path)
  if (!target.startsWith(`${artifactsDirectory}${sep}`)) {
    throw new Error('Artifact path must stay inside the imported test run')
  }
  return target
}

export function containedArtifactPath(
  runDirectory: string,
  path: string,
): string {
  const absoluteRunDirectory = resolve(runDirectory)
  const artifactsDirectory = resolve(runDirectory, 'artifacts')
  const target = resolve(path)
  if (!target.startsWith(`${artifactsDirectory}${sep}`)) {
    throw new Error('Artifact path must stay inside its owning test run')
  }
  return relative(absoluteRunDirectory, target)
}

export function validateArchiveArtifactReferences(
  archive: RunArchive,
  runDirectory: string,
): void {
  const validateSteps = (steps: readonly TestStepResult[]) => {
    for (const step of steps) {
      for (const artifact of step.artifacts ?? []) {
        importedArtifactPath(runDirectory, artifact.path)
      }
    }
  }
  for (const result of archive.manifest.results) {
    for (const attempt of result.attempts) validateSteps(attempt.steps)
  }
  for (const event of archive.events) {
    if (event.type === 'scenario-finished') validateSteps(event.attempt.steps)
    if (event.type === 'step-finished') validateSteps([event.result])
  }
}
