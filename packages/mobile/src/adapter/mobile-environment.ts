import type { EnvironmentDiagnostic } from '@pickle-spec/runner'
import {
  createMobileAdapter,
  type MobileAdapterOptions,
  type MobileExecutionTargetAdapter,
} from './mobile-adapter'

type EnvironmentAdapter = Pick<
  MobileExecutionTargetAdapter,
  'discoverTargets' | 'dispose'
>

export type MobileEnvironmentAdapterFactory = (
  options: MobileAdapterOptions,
) => EnvironmentAdapter

export interface DiagnoseMobileEnvironmentInput {
  options: MobileAdapterOptions
  requiredCapabilities?: readonly string[]
}

const defaultAdapterFactory: MobileEnvironmentAdapterFactory = (options) =>
  createMobileAdapter(options)

function platformDetails(options: MobileAdapterOptions) {
  if (options.executionTarget === 'ios-simulator') {
    return {
      id: 'mobile.ios-simulator',
      name: 'iOS Simulator',
      remediation:
        'Use macOS, install Xcode and its Command Line Tools, boot an iOS Simulator, and ensure Node 22.12 or newer is available.',
    }
  }
  return {
    id: 'mobile.android-emulator',
    name: 'Android Emulator',
    remediation:
      'Install Android Studio and the Android SDK, add adb to PATH, boot an Android Emulator, and ensure Node 22.12 or newer is available.',
  }
}

function blockedEnvironment(
  input: DiagnoseMobileEnvironmentInput,
  reason: string,
): EnvironmentDiagnostic {
  const platform = platformDetails(input.options)
  return {
    id: platform.id,
    kind: 'blocked',
    message: `${platform.name} is not ready: ${reason}`,
    remediation: [
      {
        summary: `${platform.remediation} Then run pickle doctor again.`,
      },
    ],
  }
}

function selectedTarget(
  targets: Awaited<ReturnType<EnvironmentAdapter['discoverTargets']>>,
  targetId: string | undefined,
) {
  return targets.find(
    (target) =>
      target.state === 'booted' &&
      (targetId === undefined || target.id === targetId),
  )
}

function targetDiagnostic(
  input: DiagnoseMobileEnvironmentInput,
  targets: Awaited<ReturnType<EnvironmentAdapter['discoverTargets']>>,
): EnvironmentDiagnostic {
  const target = selectedTarget(targets, input.options.targetId)
  if (!target) {
    const reason = input.options.targetId
      ? `booted target "${input.options.targetId}" was not found`
      : 'no compatible booted target was found'
    return blockedEnvironment(input, reason)
  }
  const available = new Set(target.capabilities)
  const missing = (input.requiredCapabilities ?? []).filter(
    (capability) => !available.has(capability),
  )
  if (missing.length > 0) {
    return blockedEnvironment(
      input,
      `target "${target.name}" lacks configured capabilities: ${missing.join(', ')}`,
    )
  }
  const platform = platformDetails(input.options)
  return {
    id: platform.id,
    kind: 'ready',
    message: `${platform.name} target "${target.name}" is booted and ready`,
  }
}

export async function diagnoseMobileEnvironment(
  input: DiagnoseMobileEnvironmentInput,
  createAdapter: MobileEnvironmentAdapterFactory = defaultAdapterFactory,
): Promise<EnvironmentDiagnostic> {
  let adapter: EnvironmentAdapter | undefined
  let diagnostic: EnvironmentDiagnostic
  try {
    adapter = createAdapter(input.options)
    diagnostic = targetDiagnostic(input, await adapter.discoverTargets())
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    diagnostic = blockedEnvironment(input, message)
  }
  try {
    await adapter?.dispose?.()
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    return blockedEnvironment(input, `cleanup failed: ${message}`)
  }
  return diagnostic
}
