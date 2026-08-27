import type { ResolvedFidelity } from '../adapter/fidelity'
import type { WebAdapterBehavior } from '../adapter/web-adapter'
import type { WebAdapterOptions } from '../adapter/web-options'
import { webInstructionVariables } from './web-cache-compilation'
import {
  type WebExecutionCachePayload,
  webExecutionCachePayloadSchema,
} from './web-cache-schema'

export type { WebAssertionDraft } from './web-cache-compilation'
export {
  compileObservedWebAction,
  compileWebAssertion,
  compileWebNavigation,
  instructionCoversStepVariables,
  parseObservedActionPayload,
  stepVariableNames,
  webAssertionCompileSchema,
  webAssertionDraftSchema,
  webInstructionVariables,
} from './web-cache-compilation'
export { compileObservedOutcomes } from './web-cache-outcome'
export type {
  WebExecutionCachePayload,
  WebInstruction,
  WebLocator,
  WebTemplate,
} from './web-cache-schema'
export type { WebValueProvenance } from './web-template'
export {
  bindWebTemplate,
  parameterizeWebValue,
} from './web-template'

export const defaultWebActionTimeoutMs = 15_000
export const defaultWebNavigationTimeoutMs = 15_000

export function parseWebExecutionCachePayload(
  payload: unknown,
  requiredVariables: readonly string[],
): WebExecutionCachePayload | undefined {
  const parsed = webExecutionCachePayloadSchema.safeParse(payload)
  if (!parsed.success) return undefined
  const allowed = new Set(requiredVariables)
  const referencesUnknownVariable = parsed.data.steps.some((step) =>
    step.instructions.some((instruction) =>
      [...webInstructionVariables(instruction)].some(
        (variable) => !allowed.has(variable),
      ),
    ),
  )
  return referencesUnknownVariable ? undefined : parsed.data
}

export function webPrefixStepCount(payload: WebExecutionCachePayload): number {
  return payload.steps.length
}

export function sealWebCompiledSteps(
  compiledSteps: Array<WebExecutionCachePayload['steps'][number] | undefined>,
): WebExecutionCachePayload['steps'] {
  const steps: WebExecutionCachePayload['steps'] = []
  for (const step of compiledSteps) {
    if (step === undefined) break
    steps.push(step)
  }
  return steps
}

interface WebFingerprintInput {
  options: WebAdapterOptions
  behavior: WebAdapterBehavior
  fidelity: ResolvedFidelity
}

export function webTargetConfigurationFingerprint({
  options,
  behavior,
  fidelity,
}: WebFingerprintInput): string {
  const source = JSON.stringify({
    schemaVersion: 1,
    baseUrl: new URL(options.baseUrl).toString(),
    environment: options.browser?.environment ?? 'local',
    headless: options.browser?.headless ?? true,
    fidelity: {
      profile: fidelity.profile,
      tradeOffs: fidelity.tradeOffs,
    },
    navigationPolicy: behavior.navigationPolicy ?? 'delayed',
    navigationTimeoutMs:
      options.browser?.navigationTimeoutMs ?? defaultWebNavigationTimeoutMs,
    actionTimeoutMs: options.browser?.actTimeoutMs ?? defaultWebActionTimeoutMs,
  })
  return new Bun.CryptoHasher('sha256').update(source).digest('hex')
}
