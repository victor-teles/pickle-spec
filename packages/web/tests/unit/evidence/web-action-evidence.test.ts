import type { ActionEvidence, StepExecutionContext } from '@pickle-spec/runner'
import { expect, test, vi } from 'vitest'
import type { WebAutomation } from '../../../src/adapter/web-automation'
import {
  CapturedWebActionError,
  captureWebAction,
} from '../../../src/evidence/web-action-evidence'

function automation(): WebAutomation {
  return {
    async navigate() {},
    async observe() {
      return []
    },
    async act() {
      return { success: true }
    },
    async verify() {
      return { meetsExpectation: true, actualState: 'Ready' }
    },
    async screenshot() {
      return new Uint8Array()
    },
    async summarizeTarget() {
      return { format: 'summary', summary: 'Ready' }
    },
    async readIsolationState() {
      return { cookieCount: 0, storageKeyCount: 0 }
    },
    async consumeEvidence() {
      return {
        diagnostics: [
          {
            occurredAt: '2026-08-30T12:00:00.050Z',
            level: 'warning',
            origin: 'console',
            message: 'Request retried',
          },
        ],
        activity: [
          {
            occurredAt: '2026-08-30T12:00:00.040Z',
            description: 'POST /payments',
          },
        ],
      }
    },
    async close() {},
  }
}

function actionRecorder() {
  const recordAction: NonNullable<StepExecutionContext['recordAction']> = vi.fn(
    async (input): Promise<ActionEvidence> => ({
      version: 1,
      id: 'step-1-action-1',
      ordinal: 0,
      description: input.description,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      durationMs: 1,
      state: input.state,
      message: input.message,
      source: {
        uri: 'features/checkout.feature',
        language: 'en',
        excerpt: 'When pay',
      },
      target: input.target,
      screenshots: input.screenshots,
      diagnostics: input.diagnostics ?? [],
      activity: input.activity ?? [],
    }),
  )
  return recordAction
}

test('keeps consumed browser activity with the action capsule', async () => {
  const evidence = await captureWebAction({
    automation: automation(),
    context: {
      stepIndex: 0,
      templateStep: { keyword: 'When', text: 'pay', type: 'action' },
      runtimeBindings: [],
      recordAction: actionRecorder(),
    },
    description: 'Click Pay',
    options: { baseUrl: 'https://example.test', screenshots: { mode: 'off' } },
    perform: async () => ({ success: true }),
    outcome: () => ({ state: 'passed' }),
  })

  expect(evidence.evidence).toMatchObject({
    diagnostics: [{ message: 'Request retried' }],
    activity: [{ kind: 'browser-activity', description: 'POST /payments' }],
  })
})

test('carries failed action evidence when browser execution throws', async () => {
  const operation = captureWebAction({
    automation: automation(),
    context: {
      stepIndex: 0,
      templateStep: { keyword: 'When', text: 'pay', type: 'action' },
      runtimeBindings: [],
      recordAction: actionRecorder(),
    },
    description: 'Click Pay',
    options: { baseUrl: 'https://example.test', screenshots: { mode: 'off' } },
    perform: async () => {
      throw new Error('Browser disconnected')
    },
    outcome: () => ({ state: 'passed' }),
  })

  await expect(operation).rejects.toBeInstanceOf(CapturedWebActionError)
  await expect(operation).rejects.toMatchObject({
    action: {
      description: 'Click Pay',
      evidence: {
        state: 'failed',
        message: 'Browser disconnected',
        diagnostics: [{ message: 'Request retried' }],
      },
    },
  })
})
