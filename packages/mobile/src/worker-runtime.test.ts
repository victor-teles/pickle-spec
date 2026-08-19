import { expect, test } from 'bun:test'
import type { WorkerStepExecution } from './worker-protocol'
import { type MobileDeviceGateway, MobileWorkerRuntime } from './worker-runtime'

function gateway(
  overrides: Partial<MobileDeviceGateway> = {},
): MobileDeviceGateway {
  return {
    async discoverTargets() {
      return []
    },
    async openSession() {
      return { targetId: 'emulator-5554' }
    },
    async executeStep() {
      return { state: 'passed', resolvedActions: [] }
    },
    async closeSession() {},
    async dispose() {},
    ...overrides,
  }
}

const application = {
  id: 'com.example.checkout',
  binaryPath: '/tmp/checkout.apk',
}

test('serializes mutable operations within one Android logical session', async () => {
  let active = 0
  let maximumActive = 0
  const order: string[] = []
  const runtime = new MobileWorkerRuntime(
    gateway({
      async executeStep(input): Promise<WorkerStepExecution> {
        active++
        maximumActive = Math.max(maximumActive, active)
        order.push(`start:${input.step.text}`)
        await new Promise((resolve) => setTimeout(resolve, 10))
        order.push(`end:${input.step.text}`)
        active--
        return {
          state: 'passed',
          resolvedActions: [{ description: input.step.text }],
        }
      },
    }),
  )
  await runtime.handle({
    version: 1,
    type: 'open-session',
    sessionId: 'session-1',
    application,
    mode: 'adaptive',
  })

  const first = runtime.handle({
    version: 1,
    type: 'execute-step',
    sessionId: 'session-1',
    stepIndex: 0,
    step: { type: 'action', text: 'First action' },
  })
  const second = runtime.handle({
    version: 1,
    type: 'execute-step',
    sessionId: 'session-1',
    stepIndex: 1,
    step: { type: 'action', text: 'Second action' },
  })

  await expect(Promise.all([first, second])).resolves.toMatchObject([
    { type: 'step-executed', execution: { state: 'passed' } },
    { type: 'step-executed', execution: { state: 'passed' } },
  ])
  expect(maximumActive).toBe(1)
  expect(order).toEqual([
    'start:First action',
    'end:First action',
    'start:Second action',
    'end:Second action',
  ])
})

test('supplies Replay plan actions to the matching step', async () => {
  const plannedActions: unknown[] = []
  const runtime = new MobileWorkerRuntime(
    gateway({
      async executeStep(input) {
        plannedActions.push(input.plannedActions)
        return { state: 'passed', resolvedActions: [] }
      },
    }),
  )
  await runtime.handle({
    version: 1,
    type: 'open-session',
    sessionId: 'session-1',
    application,
    mode: 'replay',
    plan: {
      steps: [
        {
          resolvedActions: [
            {
              description: 'Tap saved button',
              replay: { kind: 'find', query: 'Saved', action: 'click' },
            },
          ],
        },
      ],
    },
  })

  await runtime.handle({
    version: 1,
    type: 'execute-step',
    sessionId: 'session-1',
    stepIndex: 0,
    step: { type: 'action', text: 'Tap button' },
  })

  expect(plannedActions).toEqual([
    [
      {
        description: 'Tap saved button',
        replay: { kind: 'find', query: 'Saved', action: 'click' },
      },
    ],
  ])
})

test('cancellation stops the active device operation before the session can be reused', async () => {
  let finishOperation: (() => void) | undefined
  let cancelled = false
  const runtime = new MobileWorkerRuntime(
    gateway({
      async executeStep() {
        await new Promise<void>((resolve) => {
          finishOperation = resolve
        })
        return { state: 'cancelled', resolvedActions: [] }
      },
      async cancelSession() {
        cancelled = true
        finishOperation?.()
      },
    }),
  )
  const openRequest = {
    version: 1 as const,
    type: 'open-session' as const,
    sessionId: 'session-1',
    application,
    mode: 'adaptive' as const,
  }
  await runtime.handle(openRequest)
  const execution = runtime.handle({
    version: 1,
    type: 'execute-step',
    sessionId: 'session-1',
    stepIndex: 0,
    step: { type: 'action', text: 'Long action' },
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  await expect(
    runtime.handle({
      version: 1,
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
