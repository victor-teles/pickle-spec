import { defineAdapterConformanceSuite } from '@pickle-spec/runner/testing'
import { createMobileAdapter } from '../index'
import type { MobileWorkerClient } from './worker-client'
import type { MobileWorkerRequest } from './worker-protocol'

const specification = {
  name: 'Checkout',
  source: { uri: 'features/checkout.feature', language: 'en' },
  tags: [],
  scenarios: [],
}

const scenario = {
  name: 'Buy a product',
  tags: [],
  steps: [
    { keyword: 'When', text: 'I pay', type: 'action' as const },
    { keyword: 'Then', text: 'the receipt appears', type: 'outcome' as const },
  ],
}

const application = {
  id: 'com.example.checkout',
  binaryPath: '/tmp/checkout.apk',
}

const iosApplication = {
  id: 'com.example.checkout',
  binaryPath: '/tmp/Checkout.app',
}

function conformanceWorker(): MobileWorkerClient {
  const sessions = new Map<
    string,
    Extract<MobileWorkerRequest, { type: 'open-session' }>
  >()
  return {
    async request(request) {
      switch (request.type) {
        case 'discover-targets':
          return { version: 3, type: 'targets-discovered', targets: [] }
        case 'open-session':
          sessions.set(request.sessionId, request)
          return {
            version: 3,
            type: 'session-opened',
            sessionId: request.sessionId,
            targetId:
              request.platform === 'ios' ? 'ios-simulator-1' : 'emulator-5554',
          }
        case 'execute-scenario': {
          const session = sessions.get(request.sessionId)
          if (!session) throw new Error('Session is not open')
          return {
            version: 3,
            type: 'scenario-executed',
            sessionId: request.sessionId,
            execution: {
              stepExecutions: session.scenario.templateSteps.map((step) => ({
                state: 'passed',
                resolvedActions: [
                  {
                    description:
                      step.type === 'action'
                        ? `Act: ${step.text}`
                        : `Assert visible: ${step.text}`,
                  },
                ],
              })),
            },
          }
        }
        case 'complete-session':
          return {
            version: 3,
            type: 'session-completed',
            sessionId: request.sessionId,
            completion: { inferenceCount: 0 },
          }
        case 'close-session':
          sessions.delete(request.sessionId)
          return {
            version: 3,
            type: 'session-closed',
            sessionId: request.sessionId,
          }
        case 'cancel-session':
          sessions.delete(request.sessionId)
          return {
            version: 3,
            type: 'session-cancelled',
            sessionId: request.sessionId,
          }
      }
    },
    async dispose() {
      sessions.clear()
    },
  }
}

defineAdapterConformanceSuite({
  name: 'Android mobile',
  createAdapter: () => createMobileAdapter({ application }, conformanceWorker),
  executionTargetProfile: { id: 'android' },
  specification,
  scenario,
  expectedCapabilities: [
    'android',
    'android-emulator',
    'screenshots',
    'device-logs',
    'recordings',
    'traces',
  ],
})

defineAdapterConformanceSuite({
  name: 'iOS mobile',
  createAdapter: () =>
    createMobileAdapter(
      { executionTarget: 'ios-simulator', application: iosApplication },
      conformanceWorker,
    ),
  executionTargetProfile: { id: 'ios' },
  specification,
  scenario,
  expectedCapabilities: [
    'ios',
    'ios-simulator',
    'screenshots',
    'device-logs',
    'recordings',
    'traces',
  ],
})
