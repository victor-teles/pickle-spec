export type { FidelityPolicy } from '@pickle-spec/runner'
export type {
  BlockedResourceType,
  ResolvedFidelity,
} from './src/fidelity'
export { blockedResourceTypes, resolveFidelityPolicy } from './src/fidelity'
export type {
  BrowserOptions,
  ScreenshotOptions,
  WebAdapterOptions,
  WebAutomation,
  WebAutomationFactory,
  WebBrowserProcess,
  WebDirectExecutionResult,
  WebIsolationState,
  WebObservedAction,
} from './src/web-adapter'
export {
  createWebAdapter,
  screenshotModes,
  validateWebAdapterOptions,
  webAdapterOptionsSchema,
} from './src/web-adapter'
export type {
  RunWebPerformanceBenchmarkInput,
  WebBenchmarkMode,
  WebBenchmarkSample,
  WebBenchmarkStatistics,
  WebPerformanceBenchmarkResult,
  WebPerformanceGate,
} from './src/web-benchmark'
export {
  evaluateWebPerformanceGates,
  runWebPerformanceBenchmark,
} from './src/web-benchmark'
export type {
  WebExecutionCachePayload,
  WebInstruction,
  WebLocator,
  WebTemplate,
} from './src/web-execution-cache'
export { parseWebExecutionCachePayload } from './src/web-execution-cache'
export { defaultModelName, webProfiles } from './src/web-options'
export type { WebLogicalSession } from './src/web-pool'
export { IsolationVerificationError, WebProcessPool } from './src/web-pool'
