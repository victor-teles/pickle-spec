export type { FidelityPolicy } from '@pickle-spec/runner'
export type {
  BlockedResourceType,
  ResolvedFidelity,
} from './src/adapter/configuration/fidelity'
export {
  blockedResourceTypes,
  resolveFidelityPolicy,
} from './src/adapter/configuration/fidelity'
export type { WebEnvironmentRuntime } from './src/adapter/configuration/web-environment'
export {
  diagnoseWebEnvironment,
  webEnvironmentProbeKey,
} from './src/adapter/configuration/web-environment'
export {
  defaultModelName,
  webProfiles,
} from './src/adapter/configuration/web-options'
export type { WebLogicalSession } from './src/adapter/session/web-pool'
export {
  IsolationVerificationError,
  WebProcessPool,
} from './src/adapter/session/web-pool'
export type {
  BrowserOptions,
  ScreenshotOptions,
  WebAdapterOptions,
  WebAutomation,
  WebAutomationFactory,
  WebBrowserProcess,
  WebDirectExecutionResult,
  WebIsolationState,
  WebLiveViewportTarget,
  WebLiveViewportUpdate,
  WebObservedAction,
} from './src/adapter/web-adapter'
export {
  createWebAdapter,
  screenshotModes,
  validateWebAdapterOptions,
  webAdapterOptionsSchema,
} from './src/adapter/web-adapter'
export { resolveWebArtifactCapture } from './src/evidence/web-artifact'
export type {
  WebExecutionCachePayload,
  WebInstruction,
  WebLocator,
  WebTemplate,
} from './src/execution-cache/web-execution-cache'
export {
  parseWebExecutionCachePayload,
  webTargetConfigurationFingerprint,
} from './src/execution-cache/web-execution-cache'
export type { ReplaceWebInteractionTarget } from './src/execution-cache/web-plan-editor'
export { replaceWebInteractionTarget } from './src/execution-cache/web-plan-editor'
export { projectWebExecutionPlan } from './src/execution-cache/web-plan-projector'
export type { ValidatedWebExecutionPlan } from './src/execution-cache/web-plan-validator'
export {
  validateWebExecutionPlanCandidate,
  webPlanValidatorVersion,
} from './src/execution-cache/web-plan-validator'
