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
  BenchmarkAdapterSamples,
  BenchmarkModeSamples,
  BenchmarkTimings,
  PerformanceGateEvaluation,
  RunWebPerformanceBenchmarkInput,
  WebPerformanceBenchmarkResult,
} from './src/web-benchmark'
export {
  createMeasuringAutomationFactory,
  evaluatePerformanceGates,
  runWebPerformanceBenchmark,
} from './src/web-benchmark'
export { defaultModelName, webProfiles } from './src/web-options'
export type { WebLogicalSession } from './src/web-pool'
export { IsolationVerificationError, WebProcessPool } from './src/web-pool'
