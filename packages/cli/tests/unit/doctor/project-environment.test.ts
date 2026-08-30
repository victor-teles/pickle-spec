import { expect, test, vi } from 'vitest'
import type { PickleConfig } from '../../../src/configuration/config'
import {
  diagnoseProjectEnvironment,
  type ProjectEnvironmentProbeFunctions,
  planProjectEnvironment,
} from '../../../src/doctor/project-environment'

const config: PickleConfig = {
  schemaVersion: 1,
  executionTargetProfiles: {
    chrome: {
      adapter: 'web',
      web: { baseUrl: 'https://one.example.test' },
    },
    edge: {
      adapter: 'web',
      web: { baseUrl: 'https://two.example.test' },
    },
    android: {
      adapter: 'mobile',
      capabilities: ['android'],
      mobile: {
        executionTarget: 'android-emulator',
        application: {
          id: 'com.example.checkout',
          binaryPath: '/apps/checkout.apk',
        },
      },
    },
    custom: { adapter: 'company-device-lab' },
  },
}

test('plans configured built-ins and deduplicates equivalent local browsers', () => {
  const plan = planProjectEnvironment(config)

  expect(plan.probes).toHaveLength(2)
  expect(plan.probes[0]).toMatchObject({
    kind: 'web',
    profileIds: ['chrome', 'edge'],
  })
  expect(plan.probes[1]).toMatchObject({
    kind: 'mobile',
    profileIds: ['android'],
  })
  expect(plan.uncheckedProfileIds).toEqual(['custom'])
})

test('leaves incomplete built-in environments unchecked', () => {
  const plan = planProjectEnvironment({
    schemaVersion: 1,
    executionTargetProfiles: {
      web: { adapter: 'web' },
      mobile: { adapter: 'mobile' },
    },
  })

  expect(plan).toEqual({
    probes: [],
    uncheckedProfileIds: ['web', 'mobile'],
  })
})

test('aggregates adapter diagnostics with profile ownership', async () => {
  const web = vi.fn(async () => ({
    id: 'web.local-browser',
    kind: 'ready' as const,
    message: 'browser ready',
  }))
  const mobile = vi.fn(async () => ({
    id: 'mobile.android-emulator',
    kind: 'blocked' as const,
    message: 'emulator missing',
    remediation: [{ summary: 'Boot an Emulator' }] as const,
  }))
  const probes: ProjectEnvironmentProbeFunctions = { web, mobile }

  const report = await diagnoseProjectEnvironment(config, { probes })

  expect(web).toHaveBeenCalledTimes(1)
  expect(mobile).toHaveBeenCalledTimes(1)
  expect(report.ready).toBe(false)
  expect(report.diagnostics).toEqual([
    {
      profileIds: ['chrome', 'edge'],
      diagnostic: {
        id: 'web.local-browser',
        kind: 'ready',
        message: 'browser ready',
      },
    },
    {
      profileIds: ['android'],
      diagnostic: {
        id: 'mobile.android-emulator',
        kind: 'blocked',
        message: 'emulator missing',
        remediation: [{ summary: 'Boot an Emulator' }],
      },
    },
  ])
})
