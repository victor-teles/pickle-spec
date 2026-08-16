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
export type { WebLogicalSession } from './src/web-pool'
export { IsolationVerificationError, WebProcessPool } from './src/web-pool'
