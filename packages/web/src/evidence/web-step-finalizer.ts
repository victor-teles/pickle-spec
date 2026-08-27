import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  type EvidenceAvailability,
  isEvidenceState,
  type OpenSessionInput,
  resolveLocalProjectStorage,
  type StepExecution,
  type TestArtifact,
} from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import type { WebAutomation } from '../adapter/web-automation'
import type {
  ScreenshotOptions,
  WebAdapterOptions,
} from '../adapter/web-options'
import {
  capturedWebArtifact,
  resolveWebArtifactCapture,
  shouldFinishRecording,
} from './web-artifact'
import { projectWebStepEvidence } from './web-step-evidence'

interface CaptureResult {
  artifact?: TestArtifact
  availability: EvidenceAvailability
}

interface CreateWebStepFinalizerInput {
  input: OpenSessionInput
  options: WebAdapterOptions
  automation: WebAutomation
  stepNumber: () => number
}

type WebRecordingState = {
  started: boolean
  stopped: boolean
}

type StartWebStepRecordingInput = {
  enabled: boolean
  automation: WebAutomation
  directory: string
  state: WebRecordingState
}

type FinishWebStepRecordingInput = {
  automation: WebAutomation
  state: WebRecordingState
  stepState: StepExecution['state']
  stepNumber: number
  stepCount: number
  startFailure?: EvidenceAvailability
}

function screenshotIdentity(kind: string, value: string): string {
  const digest = new Bun.CryptoHasher('sha256').update(value).digest('hex')
  return `${kind}-${digest.slice(0, 16)}`
}

function shouldCaptureScreenshot(
  mode: NonNullable<ScreenshotOptions['mode']>,
  state: StepExecution['state'],
): boolean {
  if (mode === 'off') return false
  if (state === 'cancelled' || state === 'skipped') return false
  return mode === 'on-step' || isEvidenceState(state)
}

function recordingCaptureFailure(error: unknown): EvidenceAvailability {
  return {
    kind: 'recording',
    state: 'capture-failed',
    message:
      error instanceof Error ? error.message : 'Recording capture failed',
  }
}

async function startWebStepRecording(
  input: StartWebStepRecordingInput,
): Promise<EvidenceAvailability | undefined> {
  if (!input.enabled) return
  if (!input.automation.startRecording) return
  if (input.state.started) return
  input.state.started = true
  try {
    await mkdir(input.directory, { recursive: true })
    await input.automation.startRecording(join(input.directory, 'scenario.mp4'))
  } catch (error) {
    input.state.stopped = true
    return recordingCaptureFailure(error)
  }
}

async function finishWebStepRecording(
  input: FinishWebStepRecordingInput,
): Promise<CaptureResult | undefined> {
  if (input.startFailure) return { availability: input.startFailure }
  if (!input.state.started || input.state.stopped) return
  if (
    !shouldFinishRecording(input.stepState, input.stepNumber, input.stepCount)
  ) {
    return
  }
  input.state.stopped = true
  if (!input.automation.stopRecording) {
    return { availability: { kind: 'recording', state: 'not-requested' } }
  }
  try {
    return {
      artifact: await input.automation.stopRecording(),
      availability: { kind: 'recording', state: 'available' },
    }
  } catch (error) {
    return { availability: recordingCaptureFailure(error) }
  }
}

function withCapturedEvidence(
  execution: StepExecution,
  screenshot: CaptureResult,
  recording: CaptureResult | undefined,
): StepExecution {
  const artifacts = [
    ...(execution.artifacts ?? []),
    ...(screenshot.artifact ? [screenshot.artifact] : []),
    ...(recording?.artifact ? [recording.artifact] : []),
  ]
  return {
    ...execution,
    artifacts: artifacts.length > 0 ? artifacts : execution.artifacts,
    evidenceAvailability: [
      ...(execution.evidenceAvailability ?? []),
      screenshot.availability,
      ...(recording ? [recording.availability] : []),
    ],
  }
}

export function createWebStepFinalizer({
  input,
  options,
  automation,
  stepNumber,
}: CreateWebStepFinalizerInput) {
  const specificationArtifactId = screenshotIdentity(
    'specification',
    input.specification.id ?? input.specification.source.uri,
  )
  const scenarioArtifactId = screenshotIdentity(
    'scenario',
    input.scenario.id ??
      input.scenario.template?.name ??
      (input.runtimeBindings?.length ? 'parameterized' : input.scenario.name),
  )
  const examplesRowArtifactId = input.scenario.examplesRowId
    ? screenshotIdentity('examples-row', input.scenario.examplesRowId)
    : undefined
  let previousResolvedActionTrace: StepExecution['trace'] = []
  const recordingState: WebRecordingState = { started: false, stopped: false }
  const capture = resolveWebArtifactCapture({
    screenshotMode: options.screenshots?.mode ?? 'off',
  })

  function evidenceDirectory(): string {
    const defaultOutputDirectory = join(
      resolveLocalProjectStorage(process.cwd()).projectDirectory,
      'artifacts',
    )
    return resolve(
      options.screenshots?.outputDir ?? defaultOutputDirectory,
      specificationArtifactId,
      scenarioArtifactId,
      ...(examplesRowArtifactId ? [examplesRowArtifactId] : []),
    )
  }

  async function captureScreenshot(
    state: StepExecution['state'],
  ): Promise<CaptureResult> {
    const screenshotOptions = options.screenshots
    if (!shouldCaptureScreenshot(capture.screenshots, state)) {
      return { availability: { kind: 'screenshot', state: 'not-requested' } }
    }

    try {
      const format = screenshotOptions?.format ?? 'png'
      const directory = evidenceDirectory()
      await mkdir(directory, { recursive: true })
      const path = join(
        directory,
        `step-${String(stepNumber()).padStart(2, '0')}-${state}.${format}`,
      )
      await Bun.write(
        path,
        await automation.screenshot({
          format,
          fullPage: screenshotOptions?.fullPage ?? false,
        }),
      )
      return {
        artifact: await capturedWebArtifact(
          'screenshot',
          path,
          `image/${format}`,
        ),
        availability: { kind: 'screenshot', state: 'available' },
      }
    } catch {
      return {
        availability: {
          kind: 'screenshot',
          state: 'capture-failed',
          message: 'Screenshot capture failed',
        },
      }
    }
  }

  return async (
    execution: StepExecution,
    step: ScenarioStep,
  ): Promise<StepExecution> => {
    const collected = automation.consumeEvidence
      ? await automation.consumeEvidence()
      : { diagnostics: [], activity: [] }
    const projected = projectWebStepEvidence({
      execution,
      step,
      collected,
      previousResolvedActionTrace: previousResolvedActionTrace ?? [],
    })
    previousResolvedActionTrace = projected.nextResolvedActionTrace
    const startFailure = await startWebStepRecording({
      enabled: capture.recording,
      automation,
      directory: evidenceDirectory(),
      state: recordingState,
    })
    const screenshot = await captureScreenshot(execution.state)
    const recording = await finishWebStepRecording({
      automation,
      state: recordingState,
      stepState: execution.state,
      stepNumber: stepNumber(),
      stepCount: input.scenario.steps.length,
      startFailure,
    })
    return withCapturedEvidence(projected.execution, screenshot, recording)
  }
}
