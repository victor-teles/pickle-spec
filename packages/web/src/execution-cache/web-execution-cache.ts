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
  webAssertionDraftSchema,
  webInstructionVariables,
} from './web-cache-compilation'
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
