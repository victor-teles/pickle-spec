import type {
  OpenSessionInput,
  StepExecutionTargetAdapter,
  StepTargetSession,
} from '@pickle-spec/runner'
import { createWebStepFinalizer } from '../evidence/web-step-finalizer'
import { createWebCacheSession } from '../execution-cache/web-cache-session'
import {
  parseWebExecutionCachePayload,
  webPrefixStepCount,
  webTargetConfigurationFingerprint,
} from '../execution-cache/web-execution-cache'
import { resolveFidelityPolicy } from './fidelity'
import { stagehandFactory } from './stagehand-factory'
import type { WebAutomationFactory } from './web-automation'
import { createWebLiveSession } from './web-live-session'
import {
  type BrowserOptions,
  defaultModelName,
  resolveBrowserConnection,
  type WebAdapterOptions,
} from './web-options'
import { WebProcessPool } from './web-pool'

export type {
  WebActResult,
  WebAutomation,
  WebAutomationFactory,
  WebBrowserProcess,
  WebClientContext,
  WebDirectExecutionResult,
  WebIsolationState,
  WebObservedAction,
  WebScreenshotCapture,
  WebVerificationResult,
} from './web-automation'
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
  const resolvedBrowser = {
    ...browser,
    modelApiKey,
  }
  if (
    requireProviderApiKey &&
    requiresInference &&
    resolveBrowserConnection(resolvedBrowser).kind !== 'browserbase' &&
    !resolvedBrowser.modelApiKey
  ) {
    const envNames = providerApiKeyEnvNames(resolvedBrowser.modelName)
    throw new Error(
      'Model inference requires a provider API key or a Browserbase session. ' +
        `Set ${envNames.join(', ')}, or web.browser.modelApiKey.`,
    )
  }
  return resolvedBrowser
}

function browserOptionsForSession(
  input: OpenSessionInput,
  options: WebAdapterOptions,
  requireProviderApiKey: boolean,
): BrowserOptions {
  const executionMode = input.mode ?? 'adaptive'
  const cacheReplay =
    executionMode === 'replay' && input.executionCache !== undefined
  return resolveBrowserLaunchOptions({
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
}

function shouldNavigateEagerly(
  behavior: WebAdapterBehavior,
  cacheReplay: boolean,
  supportsInstructions: boolean,
): boolean {
  return (
    behavior.navigationPolicy === 'eager' &&
    !cacheReplay &&
    !supportsInstructions
  )
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
    capabilities: ['web', 'screenshots', 'traces', 'diagnostics', 'recordings'],
    executionCache: {
      adapterKind: 'web',
      adapterCacheSchemaVersion: '1',
      targetConfigurationFingerprint: webTargetConfigurationFingerprint({
        options,
        behavior,
        fidelity,
      }),
      parse: parseWebExecutionCachePayload,
      prefixStepCount: webPrefixStepCount,
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
      const browserOptions = browserOptionsForSession(
        input,
        options,
        requireProviderApiKey,
      )
      const logicalSession = await pool.openLogicalSession(
        browserOptions,
        input.signal,
        fidelity,
        executionMode,
      )
      const automation = logicalSession.automation
      let closePromise: Promise<void> | undefined
      let stepIndex = 0
      const finishStep = createWebStepFinalizer({
        input,
        options,
        automation,
        stepNumber: () => stepIndex,
      })

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

      let eagerlyNavigated = false
      if (
        shouldNavigateEagerly(
          behavior,
          cacheReplay,
          Boolean(automation.executeInstruction),
        )
      ) {
        await automation.navigate(options.baseUrl, input.signal)
        eagerlyNavigated = true
      }

      const runtime: Omit<StepTargetSession, 'close'> =
        cacheReplay ||
        (executionMode === 'adaptive' && automation.executeInstruction)
          ? createWebCacheSession({
              input,
              options,
              automation,
              finish: finishStep,
            })
          : createWebLiveSession({
              input,
              options,
              automation,
              finish: finishStep,
              initiallyNavigated: eagerlyNavigated,
            })

      return {
        ...runtime,
        async executeStep(step, signal, context) {
          stepIndex++
          return runtime.executeStep(step, signal, context)
        },
        close,
      }
    },
  }
}
