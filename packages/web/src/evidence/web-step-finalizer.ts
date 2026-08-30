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

interface WebStepFinalizerState extends CreateWebStepFinalizerInput {
  specificationArtifactId: string
  scenarioArtifactId: string
  examplesRowArtifactId?: string
  previousResolvedActionTrace: StepExecution['trace']
  recordingState: WebRecordingState
  recordingStartFailure?: EvidenceAvailability
  capture: ReturnType<typeof resolveWebArtifactCapture>
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
  const recordingState = input.state
  if (!input.enabled) return
  if (!input.automation.startRecording) return
  if (recordingState.started) return
  recordingState.started = true
  try {
    await mkdir(input.directory, { recursive: true })
    await input.automation.startRecording(join(input.directory, 'scenario.mp4'))
  } catch (error) {
    recordingState.stopped = true
    return recordingCaptureFailure(error)
  }
}

async function finishWebStepRecording(
  input: FinishWebStepRecordingInput,
): Promise<CaptureResult | undefined> {
  const recordingState = input.state
  if (input.startFailure) return { availability: input.startFailure }
  if (!recordingState.started || recordingState.stopped) return
  if (
    !shouldFinishRecording(input.stepState, input.stepNumber, input.stepCount)
  ) {
    return
  }
  recordingState.stopped = true
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

function withActionEvidence(execution: StepExecution): StepExecution {
  const actions = execution.resolvedActions.flatMap((action) =>
    action.evidence ? [action.evidence] : [],
  )
  const artifacts = actions.flatMap((action) =>
    [action.screenshots.before, action.screenshots.after].flatMap(
      (screenshot) =>
        screenshot.state === 'available' ? [screenshot.artifact] : [],
    ),
  )
  const diagnostics = actions.flatMap((action) => action.diagnostics)
  const activity = actions.flatMap((action) => action.activity)
  return {
    ...execution,
    artifacts:
      artifacts.length > 0
        ? [...(execution.artifacts ?? []), ...artifacts]
        : execution.artifacts,
    diagnostics:
      diagnostics.length > 0
        ? [...(execution.diagnostics ?? []), ...diagnostics]
        : execution.diagnostics,
    trace:
      activity.length > 0
        ? [...(execution.trace ?? []), ...activity]
        : execution.trace,
  }
}

function evidenceDirectory(state: WebStepFinalizerState): string {
  const defaultOutputDirectory = join(
    resolveLocalProjectStorage(process.cwd()).projectDirectory,
    'artifacts',
  )
  return resolve(
    state.options.screenshots?.outputDir ?? defaultOutputDirectory,
    state.specificationArtifactId,
    state.scenarioArtifactId,
    ...(state.examplesRowArtifactId ? [state.examplesRowArtifactId] : []),
  )
}

async function captureScreenshot(
  state: WebStepFinalizerState,
  stepState: StepExecution['state'],
): Promise<CaptureResult> {
  const screenshotOptions = state.options.screenshots
  if (!shouldCaptureScreenshot(state.capture.screenshots, stepState)) {
    return { availability: { kind: 'screenshot', state: 'not-requested' } }
  }
  try {
    const format = screenshotOptions?.format ?? 'png'
    const directory = evidenceDirectory(state)
    await mkdir(directory, { recursive: true })
    const path = join(
      directory,
      `step-${String(state.stepNumber()).padStart(2, '0')}-${stepState}.${format}`,
    )
    await Bun.write(
      path,
      await state.automation.screenshot({
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

async function finalizeWebStep(
  state: WebStepFinalizerState,
  execution: StepExecution,
  step: ScenarioStep,
): Promise<StepExecution> {
  const finalizerState = state
  const collected = finalizerState.automation.consumeEvidence
    ? await finalizerState.automation.consumeEvidence()
    : { diagnostics: [], activity: [] }
  const projected = projectWebStepEvidence({
    execution,
    step,
    collected,
    previousResolvedActionTrace:
      finalizerState.previousResolvedActionTrace ?? [],
  })
  finalizerState.previousResolvedActionTrace = projected.nextResolvedActionTrace
  const screenshot = await captureScreenshot(state, execution.state)
  const startFailure = finalizerState.recordingStartFailure
  finalizerState.recordingStartFailure = undefined
  const recording = await finishWebStepRecording({
    automation: state.automation,
    state: state.recordingState,
    stepState: execution.state,
    stepNumber: state.stepNumber(),
    stepCount: state.input.scenario.steps.length,
    startFailure,
  })
  return withActionEvidence(
    withCapturedEvidence(projected.execution, screenshot, recording),
  )
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
  const state: WebStepFinalizerState = {
    input,
    options,
    automation,
    stepNumber,
    specificationArtifactId,
    scenarioArtifactId,
    examplesRowArtifactId,
    previousResolvedActionTrace: [],
    recordingState: { started: false, stopped: false },
    capture: resolveWebArtifactCapture({
      screenshotMode: options.screenshots?.mode ?? 'off',
    }),
  }
  const finalize = (execution: StepExecution, step: ScenarioStep) =>
    finalizeWebStep(state, execution, step)
  finalize.start = async () => {
    state.recordingStartFailure = await startWebStepRecording({
      enabled: state.capture.recording,
      automation: state.automation,
      directory: evidenceDirectory(state),
      state: state.recordingState,
    })
  }
  return finalize
}
