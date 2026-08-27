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
  let recordingStarted = false
  let recordingStopped = false
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

  async function ensureRecording(): Promise<EvidenceAvailability | undefined> {
    if (!capture.recording) return
    if (!automation.startRecording) return
    if (recordingStarted) return
    recordingStarted = true
    try {
      const directory = evidenceDirectory()
      await mkdir(directory, { recursive: true })
      await automation.startRecording(join(directory, 'scenario.mp4'))
    } catch (error) {
      recordingStopped = true
      return {
        kind: 'recording',
        state: 'capture-failed',
        message:
          error instanceof Error ? error.message : 'Recording capture failed',
      }
    }
  }

  async function finishRecording(
    state: StepExecution['state'],
  ): Promise<CaptureResult | undefined> {
    const startFailure = await ensureRecording()
    if (startFailure) return { availability: startFailure }
    if (!recordingStarted || recordingStopped) return
    if (
      !shouldFinishRecording(state, stepNumber(), input.scenario.steps.length)
    ) {
      return
    }
    recordingStopped = true
    if (!automation.stopRecording) {
      return { availability: { kind: 'recording', state: 'not-requested' } }
    }
    try {
      return {
        artifact: await automation.stopRecording(),
        availability: { kind: 'recording', state: 'available' },
      }
    } catch (error) {
      return {
        availability: {
          kind: 'recording',
          state: 'capture-failed',
          message:
            error instanceof Error ? error.message : 'Recording capture failed',
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
    const screenshot = await captureScreenshot(execution.state)
    const recording = await finishRecording(execution.state)
    const artifacts = [
      ...(projected.execution.artifacts ?? []),
      ...(screenshot.artifact ? [screenshot.artifact] : []),
      ...(recording?.artifact ? [recording.artifact] : []),
    ]
    return {
      ...projected.execution,
      artifacts:
        artifacts.length > 0 ? artifacts : projected.execution.artifacts,
      evidenceAvailability: [
        ...(projected.execution.evidenceAvailability ?? []),
        screenshot.availability,
        ...(recording ? [recording.availability] : []),
      ],
    }
  }
}
