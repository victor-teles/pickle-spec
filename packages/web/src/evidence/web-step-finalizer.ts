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
import { projectWebStepEvidence } from './web-step-evidence'

interface ScreenshotCaptureResult {
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

  async function captureScreenshot(
    state: StepExecution['state'],
  ): Promise<ScreenshotCaptureResult> {
    const screenshotOptions = options.screenshots
    const mode = screenshotOptions?.mode ?? 'off'
    if (!shouldCaptureScreenshot(mode, state)) {
      return { availability: { kind: 'screenshot', state: 'not-requested' } }
    }

    try {
      const format = screenshotOptions?.format ?? 'png'
      const defaultOutputDirectory = join(
        resolveLocalProjectStorage(process.cwd()).projectDirectory,
        'artifacts',
      )
      const directory = resolve(
        screenshotOptions?.outputDir ?? defaultOutputDirectory,
        specificationArtifactId,
        scenarioArtifactId,
        ...(examplesRowArtifactId ? [examplesRowArtifactId] : []),
      )
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
        artifact: { kind: 'screenshot', path, mediaType: `image/${format}` },
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
    const capture = await captureScreenshot(execution.state)

    return {
      ...projected.execution,
      artifacts: capture.artifact
        ? [...(projected.execution.artifacts ?? []), capture.artifact]
        : projected.execution.artifacts,
      evidenceAvailability: [
        ...(projected.execution.evidenceAvailability ?? []),
        capture.availability,
      ],
    }
  }
}
