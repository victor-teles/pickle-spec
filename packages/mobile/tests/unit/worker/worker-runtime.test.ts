import { expect, test } from 'vitest'
import {
  type MobileDeviceGateway,
  MobileWorkerRuntime,
} from '../../../src/worker/worker-runtime'

const application = {
  id: 'com.example.checkout',
  binaryPath: '/tmp/checkout.apk',
}

const scenario = {
  steps: [{ type: 'action' as const, text: 'Pay' }],
  templateSteps: [{ type: 'action' as const, text: 'Pay' }],
  runtimeBindings: [],
}

function gateway(
  overrides: Partial<MobileDeviceGateway> = {},
): MobileDeviceGateway {
  return {
    async listApplications() {
      return []
    },
    async discoverTargets() {
      return []
    },
    async openSession() {
      return { targetId: 'emulator-5554' }
    },
    async executeScenario() {
      return { stepExecutions: [] }
    },
    async completeSession() {
      return { inferenceCount: 0 }
    },
    async closeSession() {},
    async dispose() {},
    ...overrides,
  }
}

const openRequest = {
  version: 6 as const,
  type: 'open-session' as const,
  sessionId: 'session-1',
  platform: 'android' as const,
  application,
  mode: 'adaptive' as const,
  scenario,
}

test('dispatches application inventory through the versioned protocol', async () => {
  const runtime = new MobileWorkerRuntime(
    gateway({
      async listApplications(platform, scope) {
        expect({ platform, scope }).toEqual({
          platform: 'android',
          scope: 'user-installed',
        })
        return ['com.example.checkout']
      },
    }),
  )

  await expect(
    runtime.handle({
      version: 6,
      type: 'list-applications',
      platform: 'android',
      scope: 'user-installed',
    }),
  ).resolves.toEqual({
    version: 6,
    type: 'applications-listed',
    applicationIds: ['com.example.checkout'],
  })
})

test('serializes Scenario execution and completion in one logical session', async () => {
  let active = 0
  let maximumActive = 0
  const order: string[] = []
  const runtime = new MobileWorkerRuntime(
    gateway({
      async executeScenario() {
        active++
        maximumActive = Math.max(maximumActive, active)
        order.push('execute:start')
        await new Promise((resolve) => setTimeout(resolve, 10))
        order.push('execute:end')
        active--
        return {
          stepExecutions: [{ state: 'passed', resolvedActions: [] }],
        }
      },
      async completeSession() {
        order.push('complete')
        return { inferenceCount: 0 }
      },
    }),
  )
  await runtime.handle(openRequest)

  const execution = runtime.handle({
    version: 6,
    type: 'execute-scenario',
    sessionId: 'session-1',
  })
  const completion = runtime.handle({
    version: 6,
    type: 'complete-session',
    sessionId: 'session-1',
  })

  await expect(Promise.all([execution, completion])).resolves.toMatchObject([
    { type: 'scenario-executed' },
    { type: 'session-completed' },
  ])
  expect(maximumActive).toBe(1)
  expect(order).toEqual(['execute:start', 'execute:end', 'complete'])
})

test('routes the full Replay cache through the gateway', async () => {
  const openings: unknown[] = []
  const runtime = new MobileWorkerRuntime(
    gateway({
      async openSession(input) {
        openings.push(input)
        return { targetId: 'emulator-5554' }
      },
    }),
  )
  const payload = {
    format: 'agent-device-ad' as const,
    script:
      'context platform=android\nopen "com.example.checkout" --relaunch\nfind "Pay" click\n',
    stepRanges: [{ from: 2, to: 2 }],
  }

  await runtime.handle({
    ...openRequest,
    mode: 'replay',
    executionCache: { adapterPayload: payload, requiredVariables: [] },
  })

  expect(openings).toEqual([
    {
      sessionId: 'session-1',
      platform: 'android',
      targetId: undefined,
      application,
      artifactDirectory: undefined,
      artifacts: undefined,
      redactions: undefined,
      requiredCapabilities: undefined,
      mode: 'replay',
      scenario,
      executionCache: { adapterPayload: payload, requiredVariables: [] },
    },
  ])
})

test('cancellation finishes the active Scenario before allowing reuse', async () => {
  let finishOperation: (() => void) | undefined
  let cancelled = false
  const runtime = new MobileWorkerRuntime(
    gateway({
      async executeScenario() {
        await new Promise<void>((resolve) => {
          finishOperation = resolve
        })
        return { stepExecutions: [] }
      },
      async cancelSession() {
        cancelled = true
        finishOperation?.()
      },
    }),
  )
  await runtime.handle(openRequest)
  const execution = runtime.handle({
    version: 6,
    type: 'execute-scenario',
    sessionId: 'session-1',
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  await expect(
    runtime.handle({
      version: 6,
      type: 'cancel-session',
      sessionId: 'session-1',
    }),
  ).resolves.toMatchObject({ type: 'session-cancelled' })
  await execution
  expect(cancelled).toBe(true)
  await expect(runtime.handle(openRequest)).resolves.toMatchObject({
    type: 'session-opened',
  })
})
