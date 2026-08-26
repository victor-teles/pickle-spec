import { createHash } from 'node:crypto'
import type { ExecutionCacheAdapter } from '@pickle-spec/runner'
import { z } from 'zod'
import type { MobilePlatform } from '../worker/worker-protocol'

export const mobileExecutionCacheAdapterKind = 'mobile.agent-device'
export const mobileExecutionCacheSchemaVersion = 'agent-device-ad.1+0.20.10'

const stepRangeSchema = z.strictObject({
  from: z.number().int().positive(),
  to: z.number().int().positive(),
})

export const mobileExecutionCachePayloadSchema = z.strictObject({
  format: z.literal('agent-device-ad'),
  script: z.string().min(1),
  stepRanges: z.array(stepRangeSchema).min(1),
})

export type MobileExecutionCachePayload = z.infer<
  typeof mobileExecutionCachePayloadSchema
>

interface CreateMobileExecutionCacheInput {
  platform: MobilePlatform
  executionTarget: 'android-emulator' | 'ios-simulator'
  applicationId: string
  targetId?: string
}

const variableNamePattern = /^[A-Za-z_][A-Za-z0-9_.-]*$/
const replayVariableNamePattern = /^[A-Z_][A-Z0-9_]*$/
const placeholderPattern = /\$\{([^}]+)\}/g
const allowedAssertionPredicates = new Set([
  'text',
  'visible',
  'hidden',
  'exists',
  'editable',
  'selected',
  'focused',
])
const quotedArgument = '"(?:\\\\.|[^"\\\\])*"'
const openPattern = new RegExp(`^open (${quotedArgument}) --relaunch$`)
const waitTextPattern = new RegExp(`^wait text ${quotedArgument}$`)
const findClickPattern = new RegExp(`^find ${quotedArgument} click$`)
const stateAssertionPattern = new RegExp(
  `^is (visible|hidden|exists|editable|selected|focused) ${quotedArgument}$`,
)
const textAssertionPattern = new RegExp(
  `^is text ${quotedArgument} ${quotedArgument}$`,
)

function hasValidRanges(ranges: MobileExecutionCachePayload['stepRanges']) {
  let previous = 1
  for (const range of ranges) {
    if (range.from > range.to || range.from <= previous) return false
    previous = range.to
  }
  return true
}

function scriptVariables(script: string): string[] | undefined {
  const variables: string[] = []
  for (const match of script.matchAll(placeholderPattern)) {
    const name = match[1]
    if (
      !name ||
      !replayVariableNamePattern.test(name) ||
      name.startsWith('AD_')
    ) {
      return undefined
    }
    variables.push(name)
  }
  return [...new Set(variables)]
}

export function mobileReplayVariableName(name: string): string {
  return `PICKLE_VAR_${createHash('sha256').update(name).digest('hex').toUpperCase()}`
}

function hasSupportedScriptShape(
  script: string,
  platform: MobilePlatform,
  applicationId: string,
): boolean {
  if (!script.endsWith('\n') || script.includes('\0')) return false
  const lines = script.split('\n').filter((line) => line.length > 0)
  if (lines[0] !== `context platform=${platform}`) return false
  if (lines.filter((line) => line.startsWith('context ')).length !== 1) {
    return false
  }
  const open = openPattern.exec(lines[1] ?? '')
  if (!open) return false
  try {
    if (JSON.parse(open[1]!) !== applicationId) return false
  } catch {
    return false
  }
  return lines.slice(2).every((line) => {
    if (waitTextPattern.test(line) || findClickPattern.test(line)) return true
    const stateAssertion = stateAssertionPattern.exec(line)
    if (
      stateAssertion?.[1] &&
      allowedAssertionPredicates.has(stateAssertion[1])
    ) {
      return true
    }
    return textAssertionPattern.test(line)
  })
}

function rangesMatchScenarioOperations(
  script: string,
  ranges: MobileExecutionCachePayload['stepRanges'],
): boolean {
  const operationCount = script.split('\n').filter(Boolean).length - 2
  return (
    ranges.length === operationCount &&
    ranges.every((range, index) => {
      const planStep = index + 2
      return range.from === planStep && range.to === planStep
    })
  )
}

function hasExactVariables(
  script: string,
  requiredVariables: readonly string[],
): boolean {
  if (
    new Set(requiredVariables).size !== requiredVariables.length ||
    requiredVariables.some(
      (name) => !variableNamePattern.test(name) || name.startsWith('AD_'),
    )
  ) {
    return false
  }
  const variables = scriptVariables(script)
  if (!variables || variables.length !== requiredVariables.length) return false
  const required = new Set(requiredVariables.map(mobileReplayVariableName))
  return variables.every((name) => required.has(name))
}

function fingerprint(input: CreateMobileExecutionCacheInput): string {
  const source = JSON.stringify({
    executionTarget: input.executionTarget,
    platform: input.platform,
    applicationId: input.applicationId,
    targetId: input.targetId ?? null,
    agentDeviceVersion: '0.20.10',
    cacheSchemaVersion: mobileExecutionCacheSchemaVersion,
  })
  return createHash('sha256').update(source).digest('hex')
}

export function createMobileExecutionCache(
  input: CreateMobileExecutionCacheInput,
): ExecutionCacheAdapter<MobileExecutionCachePayload> {
  return {
    adapterKind: mobileExecutionCacheAdapterKind,
    adapterCacheSchemaVersion: mobileExecutionCacheSchemaVersion,
    targetConfigurationFingerprint: fingerprint(input),
    parse(payload, requiredVariables) {
      const parsed = mobileExecutionCachePayloadSchema.safeParse(payload)
      if (!parsed.success) return undefined
      if (!hasValidRanges(parsed.data.stepRanges)) return undefined
      if (
        !rangesMatchScenarioOperations(
          parsed.data.script,
          parsed.data.stepRanges,
        )
      ) {
        return undefined
      }
      if (
        !hasSupportedScriptShape(
          parsed.data.script,
          input.platform,
          input.applicationId,
        )
      ) {
        return undefined
      }
      if (!hasExactVariables(parsed.data.script, requiredVariables)) {
        return undefined
      }
      return parsed.data
    },
  }
}
