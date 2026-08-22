import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { AgentDeviceClientPort } from './agent-device-client'
import type {
  MobileArtifactKind,
  MobileTextRedaction,
  WorkerStepExecution,
} from './worker-protocol'

type MobileArtifact = NonNullable<WorkerStepExecution['artifacts']>[number]

export interface AgentDeviceEvidenceSession {
  artifactDirectory?: string
  artifacts: ReadonlySet<MobileArtifactKind>
  client: AgentDeviceClientPort
  deviceLogPath?: string
  redactions: readonly MobileTextRedaction[]
}

export interface ActiveScenarioEvidence {
  directory?: string
  recordingPath?: string
  tracePath?: string
}

const screenshotResultSchema = z.object({ path: z.string().min(1) })

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

export async function startScenarioEvidence(
  sessionId: string,
  session: AgentDeviceEvidenceSession,
): Promise<ActiveScenarioEvidence> {
  if (!session.artifactDirectory || session.artifacts.size === 0) return {}
  const directory = join(session.artifactDirectory, sessionId)
  await mkdir(directory, { recursive: true })
  const active: ActiveScenarioEvidence = { directory }
  try {
    if (session.artifacts.has('recording')) {
      active.recordingPath = join(directory, 'scenario.mp4')
      await session.client.recording.record({
        action: 'start',
        path: active.recordingPath,
      })
    }
    if (session.artifacts.has('trace')) {
      active.tracePath = join(directory, 'scenario.trace')
      await session.client.recording.trace({
        action: 'start',
        path: active.tracePath,
      })
    }
    return active
  } catch (error) {
    await Promise.allSettled([
      ...(active.recordingPath
        ? [
            session.client.recording.record({
              action: 'stop',
              path: active.recordingPath,
            }),
          ]
        : []),
      ...(active.tracePath
        ? [
            session.client.recording.trace({
              action: 'stop',
              path: active.tracePath,
            }),
          ]
        : []),
    ])
    throw error
  }
}

export async function finishScenarioEvidence(
  session: AgentDeviceEvidenceSession,
  active: ActiveScenarioEvidence,
): Promise<MobileArtifact[]> {
  if (!active.directory) return []
  const artifacts: MobileArtifact[] = []
  const errors: unknown[] = []

  if (active.recordingPath) {
    try {
      await session.client.recording.record({
        action: 'stop',
        path: active.recordingPath,
      })
      artifacts.push({
        kind: 'recording',
        path: active.recordingPath,
        mediaType: 'video/mp4',
      })
    } catch (error) {
      errors.push(error)
    }
  }
  if (active.tracePath) {
    try {
      await session.client.recording.trace({
        action: 'stop',
        path: active.tracePath,
      })
      artifacts.push({ kind: 'trace', path: active.tracePath })
    } catch (error) {
      errors.push(error)
    }
  }
  if (session.artifacts.has('device-log')) {
    try {
      if (!session.deviceLogPath) {
        throw new Error('Agent Device did not provide an app log path')
      }
      const path = join(active.directory, 'scenario.log')
      const log = await readFile(session.deviceLogPath, 'utf8')
      await writeFile(path, redactText(log, session.redactions), 'utf8')
      artifacts.push({ kind: 'device-log', path, mediaType: 'text/plain' })
    } catch (error) {
      errors.push(error)
    }
  }
  if (session.artifacts.has('screenshot')) {
    try {
      const requestedPath = join(active.directory, 'scenario.png')
      const screenshot = screenshotResultSchema.parse(
        await session.client.capture.screenshot({ path: requestedPath }),
      )
      artifacts.push({
        kind: 'screenshot',
        path: screenshot.path,
        mediaType: 'image/png',
      })
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Mobile Scenario evidence capture failed')
  }
  return artifacts
}
