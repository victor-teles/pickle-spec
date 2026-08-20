import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type {
  AgentDeviceClientPort,
  MobileSelection,
} from './agent-device-client'
import { isFunctionalAgentDeviceFailure } from './agent-device-client'
import type {
  MobileArtifactKind,
  MobileStep,
  MobileTextRedaction,
  WorkerResolvedAction,
  WorkerStepExecution,
} from './worker-protocol'

export interface ExecuteAgentDeviceStepInput {
  sessionId: string
  stepIndex: number
  step: MobileStep
  plannedActions?: readonly WorkerResolvedAction[]
}

export interface AgentDeviceStepSession {
  artifactDirectory?: string
  artifacts: ReadonlySet<MobileArtifactKind>
  client: AgentDeviceClientPort
  deviceLogPath?: string
  redactions: readonly MobileTextRedaction[]
  selection: MobileSelection
}

const replayActionSchema = z.strictObject({
  kind: z.literal('find'),
  query: z.string().min(1),
  action: z.enum(['click', 'wait']),
})

const screenshotResultSchema = z.object({ path: z.string().min(1) })

type ReplayAction = z.infer<typeof replayActionSchema>
type ScreenshotArtifact = NonNullable<WorkerStepExecution['artifacts']>[number]

interface TimedEvidence {
  recordingPath?: string
  tracePath?: string
}

interface CapturedEvidence {
  artifacts: ScreenshotArtifact[]
  errors: string[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

function adaptiveAction(step: MobileStep): ReplayAction {
  return {
    kind: 'find',
    query: step.text,
    action: step.type === 'outcome' ? 'wait' : 'click',
  }
}

function adaptiveDescription(step: MobileStep): string {
  return step.type === 'outcome' ? `Verify: ${step.text}` : `Tap: ${step.text}`
}

async function executeAction(
  session: AgentDeviceStepSession,
  action: ReplayAction,
): Promise<void> {
  if (action.action === 'wait') {
    await session.client.command.wait({
      ...session.selection,
      text: action.query,
    })
    return
  }
  await session.client.interactions.find({
    ...session.selection,
    query: action.query,
    action: 'click',
  })
}

async function executeAdaptiveAction(
  input: ExecuteAgentDeviceStepInput,
  session: AgentDeviceStepSession,
  adapted: boolean,
): Promise<WorkerStepExecution> {
  const action = adaptiveAction(input.step)
  await executeAction(session, action)
  return {
    state: adapted ? 'passed-with-adaptation' : 'passed',
    resolvedActions: [
      {
        description: adaptiveDescription(input.step),
        replay: action,
      },
    ],
  }
}

async function executeStepActions(
  input: ExecuteAgentDeviceStepInput,
  session: AgentDeviceStepSession,
): Promise<WorkerStepExecution> {
  if (!input.plannedActions?.length) {
    return executeAdaptiveAction(
      input,
      session,
      input.plannedActions !== undefined,
    )
  }

  try {
    const replayActions = input.plannedActions.map((action) => ({
      resolved: action,
      replay: replayActionSchema.parse(action.replay),
    }))
    for (const action of replayActions) {
      await executeAction(session, action.replay)
    }
    return {
      state: 'passed',
      resolvedActions: replayActions.map((action) => action.resolved),
    }
  } catch (error) {
    if (!isFunctionalAgentDeviceFailure(error)) throw error
    return executeAdaptiveAction(input, session, true)
  }
}

async function captureScreenshot(
  input: ExecuteAgentDeviceStepInput,
  session: AgentDeviceStepSession,
): Promise<ScreenshotArtifact | undefined> {
  if (!session.artifactDirectory || !session.artifacts.has('screenshot')) {
    return
  }
  const directory = join(session.artifactDirectory, input.sessionId)
  await mkdir(directory, { recursive: true })
  const path = join(
    directory,
    `step-${String(input.stepIndex + 1).padStart(2, '0')}.png`,
  )
  const screenshot = screenshotResultSchema.parse(
    await session.client.capture.screenshot({ path }),
  )
  return {
    kind: 'screenshot',
    path: screenshot.path,
    mediaType: 'image/png',
  }
}

function stepArtifactPath(
  input: ExecuteAgentDeviceStepInput,
  session: AgentDeviceStepSession,
  extension: string,
): string | undefined {
  if (!session.artifactDirectory) return
  return join(
    session.artifactDirectory,
    input.sessionId,
    `step-${String(input.stepIndex + 1).padStart(2, '0')}.${extension}`,
  )
}

async function startTimedEvidence(
  input: ExecuteAgentDeviceStepInput,
  session: AgentDeviceStepSession,
): Promise<TimedEvidence> {
  if (!session.artifactDirectory) return {}
  await mkdir(join(session.artifactDirectory, input.sessionId), {
    recursive: true,
  })
  const evidence: TimedEvidence = {}
  try {
    if (session.artifacts.has('recording')) {
      evidence.recordingPath = stepArtifactPath(input, session, 'mp4')
      await session.client.recording.record({
        action: 'start',
        path: evidence.recordingPath,
      })
    }
    if (session.artifacts.has('trace')) {
      evidence.tracePath = stepArtifactPath(input, session, 'trace')
      await session.client.recording.trace({
        action: 'start',
        path: evidence.tracePath,
      })
    }
    return evidence
  } catch (error) {
    await Promise.allSettled([
      ...(evidence.recordingPath
        ? [
            session.client.recording.record({
              action: 'stop',
              path: evidence.recordingPath,
            }),
          ]
        : []),
      ...(evidence.tracePath
        ? [
            session.client.recording.trace({
              action: 'stop',
              path: evidence.tracePath,
            }),
          ]
        : []),
    ])
    throw error
  }
}

async function captureRequestedEvidence(
  input: ExecuteAgentDeviceStepInput,
  session: AgentDeviceStepSession,
  timedEvidence: TimedEvidence,
): Promise<CapturedEvidence> {
  const artifacts: ScreenshotArtifact[] = []
  const errors: string[] = []

  if (session.artifacts.has('device-log') && session.artifactDirectory) {
    const path = stepArtifactPath(input, session, 'log')
    try {
      if (!path || !session.deviceLogPath) {
        throw new Error('Agent Device did not provide an app log path')
      }
      const log = await readFile(session.deviceLogPath, 'utf8')
      await writeFile(path, redactText(log, session.redactions), 'utf8')
      artifacts.push({ kind: 'device-log', path, mediaType: 'text/plain' })
    } catch (error) {
      errors.push(`Device log capture failed: ${errorMessage(error)}`)
    }
  }

  if (timedEvidence.recordingPath) {
    try {
      await session.client.recording.record({
        action: 'stop',
        path: timedEvidence.recordingPath,
      })
      artifacts.push({
        kind: 'recording',
        path: timedEvidence.recordingPath,
        mediaType: 'video/mp4',
      })
    } catch (error) {
      errors.push(`Recording capture failed: ${errorMessage(error)}`)
    }
  }

  if (timedEvidence.tracePath) {
    try {
      await session.client.recording.trace({
        action: 'stop',
        path: timedEvidence.tracePath,
      })
      artifacts.push({ kind: 'trace', path: timedEvidence.tracePath })
    } catch (error) {
      errors.push(`Trace capture failed: ${errorMessage(error)}`)
    }
  }

  try {
    const screenshot = await captureScreenshot(input, session)
    if (screenshot) artifacts.push(screenshot)
  } catch (error) {
    errors.push(`Screenshot capture failed: ${errorMessage(error)}`)
  }

  return { artifacts, errors }
}

export async function executeAgentDeviceStep(
  input: ExecuteAgentDeviceStepInput,
  session: AgentDeviceStepSession,
): Promise<WorkerStepExecution> {
  let timedEvidence: TimedEvidence
  try {
    timedEvidence = await startTimedEvidence(input, session)
  } catch (error) {
    return {
      state: 'infrastructure-error',
      resolvedActions: [],
      message: `Test artifact capture failed: ${errorMessage(error)}`,
    }
  }

  let execution: WorkerStepExecution
  try {
    execution = await executeStepActions(input, session)
  } catch (error) {
    execution = {
      state: isFunctionalAgentDeviceFailure(error)
        ? 'failed'
        : 'infrastructure-error',
      resolvedActions: [],
      message: errorMessage(error),
    }
  }

  const evidence = await captureRequestedEvidence(input, session, timedEvidence)
  if (evidence.errors.length > 0) {
    return {
      ...execution,
      state: 'infrastructure-error',
      message: evidence.errors.join('; '),
      artifacts: evidence.artifacts.length > 0 ? evidence.artifacts : undefined,
    }
  }
  return evidence.artifacts.length > 0
    ? { ...execution, artifacts: evidence.artifacts }
    : execution
}
