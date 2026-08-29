import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { z } from 'zod'
import { requiredValue } from '../required-value'
import type {
  MobileArtifactKind,
  MobileTextRedaction,
  WorkerStepExecution,
} from '../worker/worker-protocol'
import type { AgentDeviceClientPort } from './agent-device-client'

type MobileArtifact = NonNullable<WorkerStepExecution['artifacts']>[number]
export type MobileEvidenceAvailability = NonNullable<
  WorkerStepExecution['evidenceAvailability']
>[number]
type NodeError = Error & { code?: string }

export interface AgentDeviceEvidenceSession {
  artifactDirectory?: string
  artifacts: ReadonlySet<MobileArtifactKind>
  client: AgentDeviceClientPort
  deviceLogPath?: string
  redactions: readonly MobileTextRedaction[]
}

export interface ActiveScenarioEvidence {
  availability: MobileEvidenceAvailability[]
  directory?: string
  recordingPath?: string
  tracePath?: string
}

export interface FinishedScenarioEvidence {
  artifacts: MobileArtifact[]
  availability: MobileEvidenceAvailability[]
}

interface CapturedEvidence {
  artifact?: MobileArtifact
  availability: MobileEvidenceAvailability
}

const screenshotResultSchema = z.object({ path: z.string().min(1) })

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unavailableEvidence(
  kind: MobileArtifactKind,
  error: unknown,
): MobileEvidenceAvailability {
  if (error instanceof Error && (error as NodeError).code === 'ENOENT') {
    return {
      kind,
      state: 'missing',
      message: `Captured ${kind} file is missing`,
    }
  }
  return { kind, state: 'capture-failed', message: errorMessage(error) }
}

function redactText(
  value: string,
  redactions: readonly MobileTextRedaction[],
): string {
  return redactions.reduce(
    (redacted, rule) =>
      redacted.split(rule.match).join(rule.replacement ?? '[REDACTED]'),
    value,
  )
}

async function capturedArtifact(
  kind: MobileArtifactKind,
  path: string,
  mediaType?: string,
): Promise<MobileArtifact> {
  const capturedAt = new Date().toISOString()
  const sizeBytes = (await stat(path)).size
  return {
    kind,
    path,
    mediaType,
    name: basename(path),
    capturedAt,
    sizeBytes,
  }
}

async function captureEvidence(
  kind: MobileArtifactKind,
  capture: () => Promise<MobileArtifact>,
): Promise<CapturedEvidence> {
  try {
    return {
      artifact: await capture(),
      availability: { kind, state: 'available' },
    }
  } catch (error) {
    return { availability: unavailableEvidence(kind, error) }
  }
}

function appendCapturedEvidence(
  result: CapturedEvidence,
  artifacts: MobileArtifact[],
  availability: MobileEvidenceAvailability[],
): void {
  if (result.artifact) artifacts.push(result.artifact)
  availability.push(result.availability)
}

async function stopRecording(
  session: AgentDeviceEvidenceSession,
  path: string,
): Promise<MobileArtifact> {
  await session.client.recording.record({ action: 'stop', path })
  return capturedArtifact('recording', path, 'video/mp4')
}

async function stopTrace(
  session: AgentDeviceEvidenceSession,
  path: string,
): Promise<MobileArtifact> {
  await session.client.recording.trace({ action: 'stop', path })
  return capturedArtifact('trace', path)
}

async function captureDeviceLog(
  session: AgentDeviceEvidenceSession,
  directory: string,
): Promise<MobileArtifact> {
  if (!session.deviceLogPath) {
    throw new Error('Agent Device did not provide an app log path')
  }
  const path = join(directory, 'scenario.log')
  const log = await readFile(session.deviceLogPath, 'utf8')
  await writeFile(path, redactText(log, session.redactions), 'utf8')
  return capturedArtifact('device-log', path, 'text/plain')
}

async function captureScreenshot(
  session: AgentDeviceEvidenceSession,
  directory: string,
): Promise<MobileArtifact> {
  const requestedPath = join(directory, 'scenario.png')
  const screenshot = screenshotResultSchema.parse(
    await session.client.capture.screenshot({ path: requestedPath }),
  )
  if (resolve(screenshot.path) !== resolve(requestedPath)) {
    throw new Error(
      'Agent Device returned a screenshot path outside the requested evidence location',
    )
  }
  return capturedArtifact('screenshot', screenshot.path, 'image/png')
}

export async function startScenarioEvidence(
  sessionId: string,
  session: AgentDeviceEvidenceSession,
): Promise<ActiveScenarioEvidence> {
  if (session.artifacts.size === 0) return { availability: [] }
  if (!session.artifactDirectory) {
    return {
      availability: [...session.artifacts].map((kind) => ({
        kind,
        state: 'capture-failed',
        message: 'Mobile evidence requires an artifact directory',
      })),
    }
  }

  const directory = join(session.artifactDirectory, sessionId)
  try {
    await mkdir(directory, { recursive: true })
  } catch (error) {
    return {
      availability: [...session.artifacts].map((kind) => ({
        kind,
        state: 'capture-failed',
        message: errorMessage(error),
      })),
    }
  }
  const active: ActiveScenarioEvidence = { directory, availability: [] }

  if (session.artifacts.has('recording')) {
    const path = join(directory, 'scenario.mp4')
    try {
      await session.client.recording.record({ action: 'start', path })
      active.recordingPath = path
    } catch (error) {
      active.availability.push(unavailableEvidence('recording', error))
    }
  }
  if (session.artifacts.has('trace')) {
    const path = join(directory, 'scenario.trace')
    try {
      await session.client.recording.trace({ action: 'start', path })
      active.tracePath = path
    } catch (error) {
      active.availability.push(unavailableEvidence('trace', error))
    }
  }
  return active
}

export async function finishScenarioEvidence(
  session: AgentDeviceEvidenceSession,
  active: ActiveScenarioEvidence,
): Promise<FinishedScenarioEvidence> {
  const artifacts: MobileArtifact[] = []
  const availability = [...active.availability]
  if (!active.directory) return { artifacts, availability }

  if (active.recordingPath) {
    appendCapturedEvidence(
      await captureEvidence('recording', () =>
        stopRecording(session, requiredValue(active.recordingPath)),
      ),
      artifacts,
      availability,
    )
  }
  if (active.tracePath) {
    appendCapturedEvidence(
      await captureEvidence('trace', () =>
        stopTrace(session, requiredValue(active.tracePath)),
      ),
      artifacts,
      availability,
    )
  }
  if (session.artifacts.has('device-log')) {
    appendCapturedEvidence(
      await captureEvidence('device-log', () =>
        captureDeviceLog(session, requiredValue(active.directory)),
      ),
      artifacts,
      availability,
    )
  }
  if (session.artifacts.has('screenshot')) {
    appendCapturedEvidence(
      await captureEvidence('screenshot', () =>
        captureScreenshot(session, requiredValue(active.directory)),
      ),
      artifacts,
      availability,
    )
  }
  return { artifacts, availability }
}
