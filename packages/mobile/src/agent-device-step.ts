import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { AgentDeviceClientPort } from './agent-device-client'
import { isFunctionalAgentDeviceFailure } from './agent-device-client'
import type {
  MobileStep,
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
  client: AgentDeviceClientPort
  serial: string
}

const replayActionSchema = z.strictObject({
  kind: z.literal('find'),
  query: z.string().min(1),
  action: z.enum(['click', 'wait']),
})

const screenshotResultSchema = z.object({ path: z.string().min(1) })

type ReplayAction = z.infer<typeof replayActionSchema>
type ScreenshotArtifact = NonNullable<WorkerStepExecution['artifacts']>[number]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  const selection = {
    platform: 'android' as const,
    serial: session.serial,
  }
  if (action.action === 'wait') {
    await session.client.command.wait({
      ...selection,
      text: action.query,
    })
    return
  }
  await session.client.interactions.find({
    ...selection,
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
  if (!session.artifactDirectory) return
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

export async function executeAgentDeviceStep(
  input: ExecuteAgentDeviceStepInput,
  session: AgentDeviceStepSession,
): Promise<WorkerStepExecution> {
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

  try {
    const artifact = await captureScreenshot(input, session)
    return artifact ? { ...execution, artifacts: [artifact] } : execution
  } catch (error) {
    return {
      ...execution,
      state: 'infrastructure-error',
      message: `Screenshot capture failed: ${errorMessage(error)}`,
    }
  }
}
