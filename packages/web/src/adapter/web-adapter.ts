import type { StepExecutionTargetAdapter } from '@pickle-spec/runner'
import {
  parseWebExecutionCachePayload,
  webPrefixStepCount,
  webTargetConfigurationFingerprint,
} from '../execution-cache/web-execution-cache'
import { stagehandFactory } from './automation/stagehand-factory'
import type { WebAutomationFactory } from './automation/web-automation'
import { resolveFidelityPolicy } from './configuration/fidelity'
import type { WebAdapterOptions } from './configuration/web-options'
import { WebProcessPool } from './session/web-pool'
import {
  type OpenWebSessionContext,
  openWebSession,
  type WebAdapterBehavior,
} from './session/web-session'

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
} from './automation/web-automation'
export type {
  BrowserOptions,
  ScreenshotOptions,
  WebAdapterOptions,
} from './configuration/web-options'
export {
  screenshotModes,
  validateWebAdapterOptions,
  webAdapterOptionsSchema,
} from './configuration/web-options'
export type {
  WebLiveViewportTarget,
  WebLiveViewportUpdate,
} from './live-viewport'

export type { WebAdapterBehavior } from './session/web-session'

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
