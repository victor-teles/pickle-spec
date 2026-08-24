import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  isEvidenceState,
  type ResolvedAction,
  resolveLocalProjectStorage,
  type StepExecution,
  type StepExecutionTargetAdapter,
  type TestArtifact,
} from '@pickle-spec/runner'
import type { ScenarioStep, ScenarioVariableBinding } from '@pickle-spec/spec'
import { abortError } from './abort'
import { type ResolvedFidelity, resolveFidelityPolicy } from './fidelity'
import { stagehandFactory } from './stagehand-factory'
import { createWebCacheSession } from './web-cache-session'
import type { CollectedWebEvidence } from './web-evidence'
import {
  parseWebExecutionCachePayload,
  type WebAssertionDraft,
  type WebInstruction,
  webTargetConfigurationFingerprint,
} from './web-execution-cache'
import {
  type BrowserOptions,
  defaultModelName,
  type ScreenshotOptions,
  type WebAdapterOptions,
} from './web-options'
import { WebProcessPool } from './web-pool'
import {
  errorMessage,
  navigationTarget,
  navigationUrl,
  promptFor,
} from './web-step'
import { projectWebStepEvidence } from './web-step-evidence'

export type {
  BrowserOptions,
  ScreenshotOptions,
  WebAdapterOptions,
} from './web-options'
export {
  screenshotModes,
  validateWebAdapterOptions,
  webAdapterOptionsSchema,
} from './web-options'

export interface WebObservedAction {
  description: string
  handle: unknown
}

export interface WebIsolationState {
  cookieCount: number
  storageKeyCount: number
}

export interface WebActResult {
  success: boolean
  message?: string
}

export interface WebVerificationResult {
  meetsExpectation: boolean
  actualState: string
}

export interface WebScreenshotCapture {
  format: 'png' | 'jpeg'
  fullPage: boolean
}

export interface WebClientContext {
  browser: BrowserOptions
  mode?: 'adaptive' | 'replay'
  fidelity?: ResolvedFidelity
  signal?: AbortSignal
}

export interface WebDirectExecutionResult {
  success: boolean
  actualState?: string
  message?: string
}

export interface WebAutomation {
  navigate(url: string, signal?: AbortSignal): Promise<void>
  observe(prompt: string, signal?: AbortSignal): Promise<WebObservedAction[]>
  act(action: WebObservedAction, signal?: AbortSignal): Promise<WebActResult>
  verify(prompt: string, signal?: AbortSignal): Promise<WebVerificationResult>
  compileAssertion?(
    prompt: string,
    signal?: AbortSignal,
  ): Promise<WebAssertionDraft>
  executeInstruction?(
    instruction: WebInstruction,
    bindings: readonly ScenarioVariableBinding[],
    signal?: AbortSignal,
  ): Promise<WebDirectExecutionResult>
  screenshot(options: WebScreenshotCapture): Promise<Uint8Array>
  readIsolationState(): Promise<WebIsolationState>
  consumeEvidence?(): CollectedWebEvidence | Promise<CollectedWebEvidence>
  close(): Promise<void>
}

export interface WebBrowserProcess {
  openContext(input: WebClientContext): Promise<WebAutomation>
  close(): Promise<void>
}

export interface WebAutomationFactory {
  launch(input: WebClientContext): Promise<WebBrowserProcess>
}

const providerApiKeyEnvNamesByProvider: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  groq: ['GROQ_API_KEY'],
  cerebras: ['CEREBRAS_API_KEY'],
}

type BrowserLaunchConfig = {
  browser: BrowserOptions | undefined
  requireProviderApiKey: boolean
  requiresInference: boolean
}

function screenshotIdentity(kind: string, value: string): string {
  const digest = new Bun.CryptoHasher('sha256').update(value).digest('hex')
  return `${kind}-${digest.slice(0, 16)}`
}

function replayPayload(handle: unknown): Record<string, unknown> | undefined {
  if (!handle || typeof handle !== 'object') return undefined
  try {
    return JSON.parse(JSON.stringify(handle)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function providerApiKeyEnvNames(modelName: string | undefined): string[] {
  const provider = (modelName ?? defaultModelName).split('/')[0]!
  return providerApiKeyEnvNamesByProvider[provider] ?? []
}

function resolveModelApiKey(
  browser: BrowserOptions | undefined,
): string | undefined {
  const configured = browser?.modelApiKey?.trim()
  if (configured) return configured
  for (const name of providerApiKeyEnvNames(browser?.modelName)) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
}

function resolveBrowserLaunchOptions({
  browser,
  requireProviderApiKey,
  requiresInference,
}: BrowserLaunchConfig): BrowserOptions {
  const modelApiKey = requiresInference
    ? resolveModelApiKey(browser)
    : undefined
  const next = {
    ...browser,
    modelApiKey,
  }
  if (
    requireProviderApiKey &&
    requiresInference &&
    next.environment !== 'browserbase' &&
    !next.modelApiKey
  ) {
    const envNames = providerApiKeyEnvNames(next.modelName)
    throw new Error(
      'Model inference requires a provider API key or a Browserbase session. ' +
        `Set ${envNames.join(', ')}, or web.browser.modelApiKey.`,
    )
  }
  return next
}

function shouldCaptureScreenshot(
  mode: NonNullable<ScreenshotOptions['mode']>,
  state: StepExecution['state'],
): boolean {
  if (mode === 'off') return false
  if (state === 'cancelled' || state === 'skipped') return false
  if (mode === 'on-failure') return isEvidenceState(state)
  return true
}

export interface WebAdapterBehavior {
  navigationPolicy?: 'delayed' | 'eager'
}

export function createWebAdapter(
  options: WebAdapterOptions,
  factory?: WebAutomationFactory,
  behavior: WebAdapterBehavior = {},
): StepExecutionTargetAdapter {
  const automationFactory = factory ?? stagehandFactory
  const requireProviderApiKey = factory === undefined
  const fidelity = resolveFidelityPolicy(options)
  const pool = new WebProcessPool({
    factory: automationFactory,
    idleTimeoutMs: options.browser?.idleTimeoutMs,
  })

  return {
    capabilities: ['web', 'screenshots', 'traces', 'diagnostics'],
    executionCache: {
      adapterKind: 'web',
      adapterCacheSchemaVersion: '1',
      targetConfigurationFingerprint: webTargetConfigurationFingerprint({
        options,
        behavior,
        fidelity,
      }),
      parse: parseWebExecutionCachePayload,
    },
    fidelityPolicy: {
      profile: fidelity.profile,
      tradeOffs: fidelity.tradeOffs,
    },
    async dispose() {
      await pool.dispose()
    },
    async openSession(input) {
      const executionMode = input.mode ?? 'adaptive'
      const cacheReplay =
        executionMode === 'replay' && input.executionCache !== undefined
      const browserOptions = resolveBrowserLaunchOptions({
        browser: {
          ...options.browser,
          selfHeal:
            executionMode === 'replay'
              ? false
              : (options.browser?.selfHeal ?? true),
        },
        requireProviderApiKey,
        requiresInference: !cacheReplay,
      })
      const logicalSession = await pool.openLogicalSession(
        browserOptions,
        input.signal,
        fidelity,
        executionMode,
      )
      const automation = logicalSession.automation
      let closePromise: Promise<void> | undefined
      let navigated = false
      let stepIndex = 0
      let previousResolvedActionTrace: StepExecution['trace'] = []
      const specificationArtifactId = screenshotIdentity(
        'specification',
        input.specification.id ?? input.specification.source.uri,
      )
      const scenarioArtifactId = screenshotIdentity(
        'scenario',
        input.scenario.id ??
          input.scenario.template?.name ??
          (input.runtimeBindings?.length
            ? 'parameterized'
            : input.scenario.name),
      )
      const examplesRowArtifactId = input.scenario.examplesRowId
        ? screenshotIdentity('examples-row', input.scenario.examplesRowId)
        : undefined

      const close = async () => {
        if (closePromise) return closePromise
        closePromise = (async () => {
          input.signal?.removeEventListener('abort', onAbort)
          await automation.close()
          await logicalSession.release()
        })()
        return closePromise
      }
      const onAbort = () => {
        void close()
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })

      if (
        behavior.navigationPolicy === 'eager' &&
        !cacheReplay &&
        !automation.executeInstruction
      ) {
        await automation.navigate(options.baseUrl, input.signal)
        navigated = true
      }

      async function screenshot(state: StepExecution['state']): Promise<{
        artifact?: TestArtifact
        availability: NonNullable<StepExecution['evidenceAvailability']>[number]
      }> {
        const screenshotOptions = options.screenshots
        const mode = screenshotOptions?.mode ?? 'off'
        if (!shouldCaptureScreenshot(mode, state)) {
          return {
            availability: { kind: 'screenshot', state: 'not-requested' },
          }
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
            `step-${String(stepIndex).padStart(2, '0')}-${state}.${format}`,
          )
          await Bun.write(
            path,
            await automation.screenshot({
              format,
              fullPage: screenshotOptions?.fullPage ?? false,
            }),
          )
          return {
            artifact: {
              kind: 'screenshot',
              path,
              mediaType: `image/${format}`,
            },
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

      async function finishStep(
        result: StepExecution,
        step: ScenarioStep,
      ): Promise<StepExecution> {
        const collected = automation.consumeEvidence
          ? await automation.consumeEvidence()
          : { diagnostics: [], activity: [] }
        const projected = projectWebStepEvidence({
          execution: result,
          step,
          collected,
          previousResolvedActionTrace: previousResolvedActionTrace ?? [],
        })
        previousResolvedActionTrace = projected.nextResolvedActionTrace
        const capture = await screenshot(result.state)
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

      async function ensureNavigation(signal?: AbortSignal): Promise<void> {
        if (navigated) return
        await automation.navigate(options.baseUrl, signal)
        navigated = true
      }

      async function resolveByObservation(
        prompt: string,
        signal?: AbortSignal,
      ): Promise<StepExecution> {
        let actions = await automation.observe(prompt, signal)
        if (actions.length === 0)
          actions = await automation.observe(prompt, signal)
        if (actions.length === 0) {
          return {
            state: 'failed',
            resolvedActions: [],
            message: 'Observe returned no actions',
          }
        }

        const resolvedActions: ResolvedAction[] = []
        for (const action of actions) {
          const result = await automation.act(action, signal)
          resolvedActions.push({
            description: action.description,
            replay: replayPayload(action.handle),
          })
          if (!result.success) {
            return {
              state: 'failed',
              resolvedActions,
              message: result.message ?? 'Web action failed',
            }
          }
        }
        return { state: 'passed', resolvedActions }
      }

      if (
        cacheReplay ||
        (executionMode === 'adaptive' && automation.executeInstruction)
      ) {
        const cacheSession = createWebCacheSession({
          input,
          options,
          automation,
          finish: finishStep,
        })
        return {
          ...cacheSession,
          async executeStep(step, signal, context) {
            stepIndex++
            return cacheSession.executeStep(step, signal, context)
          },
          close,
        }
      }

      return {
        async executeStep(step, signal) {
          stepIndex++
          const operationSignal = signal ?? input.signal
          if (operationSignal?.aborted) throw abortError()
          const prompt = promptFor(step)

          try {
            const target = navigationTarget(prompt)
            if (target) {
              const url = navigationUrl(options.baseUrl, target)
              await automation.navigate(url, operationSignal)
              navigated = true
              return finishStep(
                {
                  state: 'passed',
                  resolvedActions: [{ description: `Navigate to ${url}` }],
                },
                step,
              )
            }

            await ensureNavigation(operationSignal)
            if (step.type === 'outcome') {
              const verification = await automation.verify(
                prompt,
                operationSignal,
              )
              if (!verification.meetsExpectation) {
                return finishStep(
                  {
                    state: 'failed',
                    resolvedActions: [{ description: `Verify: ${prompt}` }],
                    message: `Expected: "${prompt}" | Actual: ${verification.actualState}`,
                  },
                  step,
                )
              }
              return finishStep(
                {
                  state: 'passed',
                  resolvedActions: [{ description: `Verify: ${prompt}` }],
                },
                step,
              )
            }

            return finishStep(
              await resolveByObservation(prompt, operationSignal),
              step,
            )
          } catch (error) {
            if (
              operationSignal?.aborted ||
              (error instanceof Error && error.name === 'AbortError')
            ) {
              throw abortError()
            }
            return finishStep(
              {
                state: 'infrastructure-error',
                resolvedActions: [],
                message: errorMessage(error),
              },
              step,
            )
          }
        },
        close,
      }
    },
  }
}
