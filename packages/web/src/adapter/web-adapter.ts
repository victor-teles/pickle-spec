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
import { requiredValue } from '../required-value'
import { type ResolvedFidelity, resolveFidelityPolicy } from './fidelity'
import { stagehandFactory } from './stagehand-factory'
import type { WebAutomation, WebAutomationFactory } from './web-automation'
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
  const provider = requiredValue((modelName ?? defaultModelName).split('/')[0])
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

type LogicalWebSession = Awaited<
  ReturnType<WebProcessPool['openLogicalSession']>
>

interface OpenWebSessionContext {
  options: WebAdapterOptions
  behavior: WebAdapterBehavior
  requireProviderApiKey: boolean
  fidelity: ResolvedFidelity
  pool: WebProcessPool
}

function webSessionCloser(
  input: OpenSessionInput,
  automation: WebAutomation,
  logicalSession: LogicalWebSession,
): () => Promise<void> {
  let closePromise: Promise<void> | undefined
  const close = async () => {
    if (closePromise) return closePromise
    closePromise = (async () => {
      input.signal?.removeEventListener('abort', onAbort)
      await automation.close()
      await logicalSession.release()
    })()
    return closePromise
  }
  const onAbort = () => void close()
  input.signal?.addEventListener('abort', onAbort, { once: true })
  return close
}

function createWebRuntime(
  cacheReplay: boolean,
  executionMode: OpenSessionInput['mode'],
  input: OpenSessionInput,
  options: WebAdapterOptions,
  automation: WebAutomation,
  finish: ReturnType<typeof createWebStepFinalizer>,
  initiallyNavigated: boolean,
): Omit<StepTargetSession, 'close'> {
  if (
    cacheReplay ||
    (executionMode === 'adaptive' && automation.executeInstruction)
  ) {
    return createWebCacheSession({ input, options, automation, finish })
  }
  return createWebLiveSession({
    input,
    options,
    automation,
    finish,
    initiallyNavigated,
  })
}

async function openWebSession(
  context: OpenWebSessionContext,
  input: OpenSessionInput,
): Promise<StepTargetSession> {
  const executionMode = input.mode ?? 'adaptive'
  const cacheReplay =
    executionMode === 'replay' && input.executionCache !== undefined
  const browserOptions = browserOptionsForSession(
    input,
    context.options,
    context.requireProviderApiKey,
  )
  const logicalSession = await context.pool.openLogicalSession(
    browserOptions,
    input.signal,
    context.fidelity,
    executionMode,
  )
  const automation = logicalSession.automation
  const close = webSessionCloser(input, automation, logicalSession)
  let stepIndex = 0
  const finish = createWebStepFinalizer({
    input,
    options: context.options,
    automation,
    stepNumber: () => stepIndex,
  })
  let eagerlyNavigated = false
  if (
    shouldNavigateEagerly(
      context.behavior,
      cacheReplay,
      Boolean(automation.executeInstruction),
    )
  ) {
    await automation.navigate(context.options.baseUrl, input.signal)
    eagerlyNavigated = true
  }
  const runtime = createWebRuntime(
    cacheReplay,
    executionMode,
    input,
    context.options,
    automation,
    finish,
    eagerlyNavigated,
  )
  return {
    async executeStep(step, signal, stepContext) {
      stepIndex++
      return runtime.executeStep(step, signal, stepContext)
    },
    ...(runtime.complete
      ? { complete: () => requiredValue(runtime.complete).call(runtime) }
      : {}),
    close,
  }
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
  const sessionContext: OpenWebSessionContext = {
    options,
    behavior,
    requireProviderApiKey,
    fidelity,
    pool,
  }

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
      return openWebSession(sessionContext, input)
    },
  }
}
