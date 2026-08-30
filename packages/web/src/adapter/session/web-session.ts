import type { OpenSessionInput, StepTargetSession } from '@pickle-spec/runner'
import { createWebStepFinalizer } from '../../evidence/web-step-finalizer'
import { createWebCacheSession } from '../../execution-cache/web-cache-session'
import { requiredValue } from '../../required-value'
import { abortError, isAbortError, withAbort } from '../automation/abort'
import type { WebAutomation } from '../automation/web-automation'
import type { ResolvedFidelity } from '../configuration/fidelity'
import type { WebAdapterOptions } from '../configuration/web-options'
import { browserOptionsForSession } from './web-browser-options'
import { createWebLiveSession } from './web-live-session'
import type { WebProcessPool } from './web-pool'

export interface WebAdapterBehavior {
  navigationPolicy?: 'delayed' | 'eager'
}

type LogicalWebSession = Awaited<
  ReturnType<WebProcessPool['openLogicalSession']>
>

export interface OpenWebSessionContext {
  options: WebAdapterOptions
  behavior: WebAdapterBehavior
  requireProviderApiKey: boolean
  fidelity: ResolvedFidelity
  pool: WebProcessPool
}

interface CloseWebSessionInput {
  automation: WebAutomation
  interrupted: () => boolean
  logicalSession: LogicalWebSession
  signal?: AbortSignal
}

async function closeWebSession(input: CloseWebSessionInput): Promise<void> {
  const automationClose = input.automation.close()
  if (input.interrupted()) {
    await input.logicalSession.discard()
    await automationClose
    return
  }
  try {
    await withAbort(automationClose, input.signal)
  } catch (error) {
    await input.logicalSession.discard()
    if (isAbortError(error, input.signal)) {
      await automationClose
      return
    }
    throw error
  }
  if (input.interrupted()) await input.logicalSession.discard()
  else await input.logicalSession.release()
}

function sessionCloser(
  input: OpenSessionInput,
  automation: WebAutomation,
  logicalSession: LogicalWebSession,
) {
  let closePromise: Promise<void> | undefined
  let interrupted = Boolean(input.signal?.aborted)
  const markInterrupted = () => {
    interrupted = true
  }
  const close = async () => {
    if (closePromise) return closePromise
    input.signal?.removeEventListener('abort', onAbort)
    closePromise = closeWebSession({
      automation,
      interrupted: () => interrupted || Boolean(input.signal?.aborted),
      logicalSession,
      signal: input.signal,
    })
    return closePromise
  }
  const onAbort = () => {
    markInterrupted()
    void close()
  }
  input.signal?.addEventListener('abort', onAbort, { once: true })
  return { close, markInterrupted }
}

function shouldNavigateEagerly(
  behavior: WebAdapterBehavior,
  cacheReplay: boolean,
  automation: WebAutomation,
): boolean {
  return (
    behavior.navigationPolicy === 'eager' &&
    !cacheReplay &&
    !automation.executeInstruction
  )
}

interface CreateRuntimeInput {
  automation: WebAutomation
  cacheReplay: boolean
  context: OpenWebSessionContext
  executionMode: OpenSessionInput['mode']
  finish: ReturnType<typeof createWebStepFinalizer>
  input: OpenSessionInput
}

async function createRuntime({
  automation,
  cacheReplay,
  context,
  executionMode,
  finish,
  input,
}: CreateRuntimeInput): Promise<Omit<StepTargetSession, 'close'>> {
  if (
    cacheReplay ||
    (executionMode === 'adaptive' && automation.executeInstruction)
  ) {
    return createWebCacheSession({
      input,
      options: context.options,
      automation,
      finish,
    })
  }
  const initiallyNavigated = shouldNavigateEagerly(
    context.behavior,
    cacheReplay,
    automation,
  )
  if (initiallyNavigated) {
    await automation.navigate(context.options.baseUrl, input.signal)
  }
  return createWebLiveSession({
    input,
    options: context.options,
    automation,
    finish,
    initiallyNavigated,
  })
}

export async function openWebSession(
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
  const { close, markInterrupted } = sessionCloser(
    input,
    automation,
    logicalSession,
  )
  if (input.signal?.aborted) {
    await close()
    throw abortError()
  }
  let stepIndex = 0
  const runtime = await createRuntime({
    automation,
    cacheReplay,
    context,
    executionMode,
    finish: createWebStepFinalizer({
      input,
      options: context.options,
      automation,
      stepNumber: () => stepIndex,
    }),
    input,
  })
  return {
    async executeStep(step, signal, stepContext) {
      stepIndex++
      try {
        return await runtime.executeStep(step, signal, stepContext)
      } catch (error) {
        if (isAbortError(error, signal)) markInterrupted()
        throw error
      }
    },
    ...(runtime.complete
      ? { complete: () => requiredValue(runtime.complete).call(runtime) }
      : {}),
    close,
  }
}
