import { copyFile, mkdir, rename, rm, rmdir, stat } from 'node:fs/promises'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  sep as pathSeparator,
  relative,
} from 'node:path'
import type {
  EvidenceKind,
  RunEventPayload,
  ScenarioAttempt,
  TestArtifact,
  TestStepResult,
} from '../../execution/run-scenario'

type EvidenceCaptureFailure = {
  kind: EvidenceKind
  message: string
}

export type PersistedStepEvidence = {
  step: TestStepResult
  publishedPaths: string[]
  captureFailures: EvidenceCaptureFailure[]
}

export function withoutProvisionalActionEvidence(
  action: Extract<RunEventPayload, { type: 'action-finished' }>['action'],
): Extract<RunEventPayload, { type: 'action-finished' }>['action'] {
  const withoutFile = (
    screenshot: typeof action.screenshots.before,
  ): typeof action.screenshots.before =>
    screenshot.state === 'available' ? { state: 'not-retained' } : screenshot
  return {
    ...action,
    screenshots: {
      before: withoutFile(action.screenshots.before),
      after: withoutFile(action.screenshots.after),
    },
    diagnostics: [],
    activity: [],
  }
}

function withoutActionEvidenceFiles(step: TestStepResult): TestStepResult {
  return {
    ...step,
    resolvedActions: step.resolvedActions.map((action) => {
      if (!action.evidence) return action
      const unavailable = (state: typeof action.evidence.screenshots.before) =>
        state.state === 'available' ? { state: 'not-retained' as const } : state
      return {
        ...action,
        evidence: {
          ...action.evidence,
          screenshots: {
            before: unavailable(action.evidence.screenshots.before),
            after: unavailable(action.evidence.screenshots.after),
          },
          diagnostics: [],
          activity: [],
        },
      }
    }),
  }
}

export function withoutStepEvidence(step: TestStepResult): TestStepResult {
  const {
    artifacts: _artifacts,
    diagnostics: _diagnostics,
    trace: _trace,
    ...rest
  } = step
  return withoutActionEvidenceFiles(rest)
}

export function withoutAttemptEvidence(
  attempt: ScenarioAttempt,
): ScenarioAttempt {
  const kinds = new Set(
    attempt.steps.flatMap((step) => [
      ...(step.artifacts ?? []).map((artifact) => artifact.kind),
      ...(step.diagnostics?.length ? ['diagnostics' as const] : []),
      ...(step.trace?.length ? ['trace' as const] : []),
    ]),
  )
  if (attempt.diagnostics?.length) kinds.add('diagnostics')
  const { diagnostics: _diagnostics, ...attemptWithoutDiagnostics } = attempt
  return {
    ...attemptWithoutDiagnostics,
    steps: attempt.steps.map(withoutStepEvidence),
    evidenceAvailability: attempt.evidenceAvailability.map((availability) => {
      const wasCaptured = kinds.has(availability.kind)
      return wasCaptured && availability.state === 'available'
        ? { ...availability, state: 'not-retained' }
        : availability
    }),
    applicationOutputAvailability: attempt.applicationOutputAvailability?.map(
      (availability) =>
        availability.state === 'available'
          ? { ...availability, state: 'not-retained' as const }
          : availability,
    ),
  }
}

export async function copyStepArtifacts(
  step: TestStepResult,
  artifactsDirectory: string,
  name: string,
): Promise<PersistedStepEvidence> {
  if (!step.artifacts?.length) {
    return { step, publishedPaths: [], captureFailures: [] }
  }
  const stagingRoot = join(dirname(artifactsDirectory), '.evidence-staging')
  const stagingDirectory = join(stagingRoot, crypto.randomUUID())
  try {
    await Promise.all([
      mkdir(artifactsDirectory, { recursive: true }),
      mkdir(stagingDirectory, { recursive: true }),
    ])
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true })
    await rmdir(stagingRoot).catch(() => undefined)
    return captureFailedStep(step, error)
  }
  const publishedPaths: string[] = []
  const captureFailures: EvidenceCaptureFailure[] = []
  const artifacts: TestArtifact[] = []
  const copiedBySourcePath = new Map<string, TestArtifact>()
  try {
    for (const [index, artifact] of step.artifacts.entries()) {
      const copied = await copyStepArtifact(
        artifact,
        index,
        artifactsDirectory,
        stagingDirectory,
        name,
      )
      appendCopiedStepArtifact(
        copied,
        artifacts,
        publishedPaths,
        captureFailures,
      )
      if (copied.artifact) {
        copiedBySourcePath.set(artifact.path, copied.artifact)
      }
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true })
    await rmdir(stagingRoot).catch(() => undefined)
  }
  return {
    step: {
      ...mapActionEvidenceArtifacts(step, copiedBySourcePath),
      artifacts: artifacts.length > 0 ? artifacts : undefined,
    },
    publishedPaths,
    captureFailures,
  }
}

export function mapActionEvidenceArtifacts(
  step: TestStepResult,
  copiedBySourcePath: ReadonlyMap<string, TestArtifact>,
): TestStepResult {
  const screenshot = (
    value: NonNullable<
      TestStepResult['resolvedActions'][number]['evidence']
    >['screenshots']['before'],
  ) => {
    if (value.state !== 'available') return value
    const artifact = copiedBySourcePath.get(value.artifact.path)
    return artifact
      ? { state: 'available' as const, artifact }
      : { state: 'capture-failed' as const, message: 'Screenshot copy failed' }
  }
  return {
    ...step,
    resolvedActions: step.resolvedActions.map((action) =>
      action.evidence
        ? {
            ...action,
            evidence: {
              ...action.evidence,
              screenshots: {
                before: screenshot(action.evidence.screenshots.before),
                after: screenshot(action.evidence.screenshots.after),
              },
            },
          }
        : action,
    ),
  }
}

interface CopiedStepArtifact {
  artifact?: TestArtifact
  publishedPath?: string
  captureFailure?: EvidenceCaptureFailure
}

function appendCopiedStepArtifact(
  copied: CopiedStepArtifact,
  artifacts: TestArtifact[],
  publishedPaths: string[],
  captureFailures: EvidenceCaptureFailure[],
): void {
  if (copied.artifact) artifacts.push(copied.artifact)
  if (copied.publishedPath) publishedPaths.push(copied.publishedPath)
  if (copied.captureFailure) captureFailures.push(copied.captureFailure)
}

async function copyStepArtifact(
  artifact: TestArtifact,
  index: number,
  artifactsDirectory: string,
  stagingDirectory: string,
  name: string,
): Promise<CopiedStepArtifact> {
  const managedPath = relative(artifactsDirectory, artifact.path)
  if (
    managedPath !== '' &&
    managedPath !== '..' &&
    !managedPath.startsWith(`..${pathSeparator}`) &&
    !isAbsolute(managedPath)
  ) {
    return { artifact }
  }
  const path = artifactDestination(artifact, index, artifactsDirectory, name)
  if (artifact.path === path) return { artifact }
  const stagedPath = join(stagingDirectory, basename(path))
  try {
    await copyFile(artifact.path, stagedPath)
    if (await pathExists(path)) {
      throw new Error(`Test artifact destination already exists: ${path}`)
    }
    await rename(stagedPath, path)
    return { artifact: { ...artifact, path }, publishedPath: path }
  } catch (error) {
    return {
      captureFailure: {
        kind: artifact.kind,
        message: `${artifact.path}: ${errorMessage(error)}`,
      },
    }
  }
}

export function artifactDestination(
  artifact: TestArtifact,
  index: number,
  artifactsDirectory: string,
  name: string,
): string {
  const extension = extname(artifact.path) || '.bin'
  const filename =
    index === 0
      ? `${slug(name)}${extension}`
      : `${slug(name)}-${index + 1}${extension}`
  return join(artifactsDirectory, filename)
}

function captureFailedStep(
  step: TestStepResult,
  error: unknown,
): PersistedStepEvidence {
  const { artifacts: _artifacts, ...stepWithoutArtifacts } = step
  return {
    step: stepWithoutArtifacts,
    publishedPaths: [],
    captureFailures: (step.artifacts ?? []).map((artifact) => ({
      kind: artifact.kind,
      message: `${artifact.path}: ${errorMessage(error)}`,
    })),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
