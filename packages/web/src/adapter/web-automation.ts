import type { TestArtifact } from '@pickle-spec/runner'
import type { ScenarioVariableBinding } from '@pickle-spec/spec'
import type { CollectedWebEvidence } from '../evidence/web-evidence'
import type {
  WebAssertionDraft,
  WebInstruction,
} from '../execution-cache/web-execution-cache'
import type { ResolvedFidelity } from './fidelity'
import type { BrowserOptions } from './web-options'

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
  ): Promise<WebAssertionDraft | readonly WebAssertionDraft[]>
  executeInstruction?(
    instruction: WebInstruction,
    bindings: readonly ScenarioVariableBinding[],
    signal?: AbortSignal,
  ): Promise<WebDirectExecutionResult>
  screenshot(options: WebScreenshotCapture): Promise<Uint8Array>
  startRecording?(path: string): Promise<void>
  stopRecording?(): Promise<TestArtifact>
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
