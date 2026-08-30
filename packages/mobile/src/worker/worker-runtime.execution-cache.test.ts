import { expect, test } from 'vitest'
import { mobileReplayVariableName } from '../execution-cache/mobile-execution-cache'
import { type MobileDeviceGateway, MobileWorkerRuntime } from './worker-runtime'

const productPlaceholder = [
  '$',
  `{${mobileReplayVariableName('product')}}`,
].join('')

const application = {
  id: 'com.example.checkout',
  binaryPath: '/tmp/checkout.apk',
}

const scenario = {
  steps: [
    { type: 'action' as const, text: 'Buy Pickles' },
    { type: 'outcome' as const, text: 'Receipt' },
  ],
  templateSteps: [
    { type: 'action' as const, text: 'Buy <product>' },
    { type: 'outcome' as const, text: 'Receipt' },
  ],
  runtimeBindings: [{ name: 'product', value: 'Pickles' }],
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

test('routes one complete Scenario through the versioned worker protocol', async () => {
  const openings: unknown[] = []
  const runtime = new MobileWorkerRuntime(
    gateway({
      async openSession(input) {
        openings.push(input)
        return { targetId: 'emulator-5554' }
      },
      async executeScenario() {
        return {
          stepExecutions: scenario.steps.map((step) => ({
            state: 'passed' as const,
            resolvedActions: [{ description: step.text }],
          })),
        }
      },
      async completeSession() {
        return {
          inferenceCount: 0,
          replayRepresentation: {
            cacheable: true as const,
            requiredVariables: ['product'],
            adapterPayload: {
              format: 'agent-device-ad' as const,
              script:
                'context platform=android\n' +
                'open "com.example.checkout" --relaunch\n' +
                `find "Buy ${productPlaceholder}" click\n` +
                'is visible "text=\\"Receipt\\""\n',
              stepRanges: [
                { from: 2, to: 2 },
                { from: 3, to: 3 },
              ],
            },
          },
        }
      },
    }),
  )

  await expect(
    runtime.handle({
      version: 6,
      type: 'open-session',
      sessionId: 'session-1',
      platform: 'android',
      application,
      mode: 'adaptive',
      scenario,
    }),
  ).resolves.toMatchObject({ version: 6, type: 'session-opened' })
  await expect(
    runtime.handle({
      version: 6,
      type: 'execute-scenario',
      sessionId: 'session-1',
    }),
  ).resolves.toMatchObject({
    version: 6,
    type: 'scenario-executed',
    execution: { stepExecutions: [{ state: 'passed' }, { state: 'passed' }] },
  })
  await expect(
    runtime.handle({
      version: 6,
      type: 'complete-session',
      sessionId: 'session-1',
    }),
  ).resolves.toMatchObject({
    version: 6,
    type: 'session-completed',
    completion: {
      inferenceCount: 0,
      replayRepresentation: { cacheable: true, requiredVariables: ['product'] },
    },
  })
  expect(openings).toEqual([
    expect.objectContaining({
      sessionId: 'session-1',
      mode: 'adaptive',
      scenario,
    }),
  ])
})
