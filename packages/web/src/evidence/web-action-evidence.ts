import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ActionEvidence,
  ActionScreenshot,
  StepExecutionContext,
} from '@pickle-spec/runner'
import { resolveLocalProjectStorage } from '@pickle-spec/runner'
import type { WebAutomation } from '../adapter/web-automation'
import type { WebAdapterOptions } from '../adapter/web-options'
import { capturedWebArtifact, resolveWebArtifactCapture } from './web-artifact'

type ActionOutcome = { state: 'passed' | 'failed'; message?: string }

interface CaptureWebActionInput<Result> {
  automation: WebAutomation
  context: StepExecutionContext
  description: string
  options: WebAdapterOptions
  perform: () => Promise<Result>
  outcome: (result: Result) => ActionOutcome
}

export class CapturedWebActionError extends Error {
  readonly action: { description: string; evidence?: ActionEvidence }

  constructor(
    cause: unknown,
    description: string,
    evidence: ActionEvidence | undefined,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = cause instanceof Error ? cause.name : 'CapturedWebActionError'
    this.action = { description, evidence }
  }
}

export function capturedActionFromError(error: unknown) {
  return error instanceof CapturedWebActionError ? error.action : undefined
}

async function targetState(automation: WebAutomation) {
  return (
    (await automation.summarizeTarget?.()) ?? {
      format: 'summary' as const,
      summary: 'Target summary is not supported by this web automation',
    }
  )
}

async function actionScreenshot(
  automation: WebAutomation,
  options: WebAdapterOptions,
  position: 'before' | 'after',
): Promise<ActionScreenshot> {
  const capture = resolveWebArtifactCapture({
    screenshotMode: options.screenshots?.mode,
  })
  if (capture.screenshots === 'off') return { state: 'not-requested' }
  try {
    const format = options.screenshots?.format ?? 'png'
    const defaultOutputDirectory = join(
      resolveLocalProjectStorage(process.cwd()).projectDirectory,
      'artifacts',
    )
    const directory = join(
      options.screenshots?.outputDir ?? defaultOutputDirectory,
      'action-evidence',
    )
    await mkdir(directory, { recursive: true })
    const path = join(directory, `${crypto.randomUUID()}-${position}.${format}`)
    await Bun.write(
      path,
      await automation.screenshot({
        format,
        fullPage: options.screenshots?.fullPage ?? false,
      }),
    )
    return {
      state: 'available',
      artifact: await capturedWebArtifact(
        'screenshot',
        path,
        `image/${format}`,
      ),
    }
  } catch (error) {
    return {
      state: 'capture-failed',
      message: error instanceof Error ? error.message : 'Screenshot failed',
    }
  }
}

export async function captureWebAction<Result>(
  input: CaptureWebActionInput<Result>,
): Promise<{ result: Result; evidence?: ActionEvidence }> {
  if (!input.context.recordAction) return { result: await input.perform() }
  const startedAt = new Date().toISOString()
  const [before, beforeScreenshot] = await Promise.all([
    targetState(input.automation),
    actionScreenshot(input.automation, input.options, 'before'),
  ])
  let result: Result
  try {
    result = await input.perform()
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const [after, afterScreenshot, collected] = await Promise.all([
      targetState(input.automation),
      actionScreenshot(input.automation, input.options, 'after'),
      input.automation.consumeEvidence?.() ?? { diagnostics: [], activity: [] },
    ])
    const evidence = await input.context.recordAction({
      description: input.description,
      startedAt,
      finishedAt,
      state: 'failed',
      message: error instanceof Error ? error.message : String(error),
      target: { before, after },
      screenshots: { before: beforeScreenshot, after: afterScreenshot },
      diagnostics: collected.diagnostics,
      activity: collected.activity.map((entry) => ({
        ...entry,
        causalAt: finishedAt,
        kind: 'browser-activity',
      })),
    })
    throw new CapturedWebActionError(error, input.description, evidence)
  }
  const finishedAt = new Date().toISOString()
  const [after, afterScreenshot, collected] = await Promise.all([
    targetState(input.automation),
    actionScreenshot(input.automation, input.options, 'after'),
    input.automation.consumeEvidence?.() ?? { diagnostics: [], activity: [] },
  ])
  const outcome = input.outcome(result)
  const evidence = await input.context.recordAction({
    description: input.description,
    startedAt,
    finishedAt,
    ...outcome,
    target: { before, after },
    screenshots: { before: beforeScreenshot, after: afterScreenshot },
    diagnostics: collected.diagnostics,
    activity: collected.activity.map((entry) => ({
      ...entry,
      causalAt: finishedAt,
      kind: 'browser-activity',
    })),
  })
  return { result, evidence }
}
