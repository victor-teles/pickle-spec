import { parseSpecification } from '@pickle-spec/spec'
import type { CredentialStore } from '@pickle-spec/studio'
import { expect, test } from 'vitest'
import type { PickleConfig } from '../../../src/configuration/config'
import {
  studioRunReadiness,
  studioRunReadinessWithEnvironment,
} from '../../../src/studio/studio-project'

const credentials: CredentialStore = {
  async get() {},
  async has() {
    return false
  },
  async set() {},
}

const config: PickleConfig = {
  schemaVersion: 1,
  executionTargetProfiles: {
    chrome: { adapter: 'custom' },
  },
}

const specification = parseSpecification({
  uri: 'features/checkout.feature',
  source: `@pickle:id:speccheckaaaaaaaa @pickle:state:active
Feature: Checkout
  @pickle:id:scnblockedaaaaaaa @pickle:requires:geolocation
  Scenario: Locate the customer
    Then the location is available

  @pickle:id:scnreadybbbbbbbbb
  Scenario: Pay for the order
    Then payment is captured
`,
})

test('derives aggregate readiness from structured checks', async () => {
  const readiness = await studioRunReadiness(
    { root: '/project', credentials },
    {
      paths: [specification.source.uri],
      scenarioName: 'Locate the customer',
    },
    config,
    [specification],
  )

  expect(readiness.ready).toBe(false)
  expect(readiness.checks?.map((check) => [check.id, check.status])).toEqual([
    ['selection', 'ready'],
    ['execution-target', 'blocked'],
    ['model-credential', 'not-applicable'],
    ['environment', 'not-applicable'],
  ])
  const blockedReasons = (readiness.checks ?? []).flatMap((check) =>
    check.status === 'blocked' ? check.reasons : [],
  )
  expect(readiness.reasons).toEqual(blockedReasons)
  expect(readiness.reasons.join(' ')).toContain('geolocation')
})

test('validates only the durable scenarioId while preserving scenarioName selection', async () => {
  const exactReadiness = await studioRunReadiness(
    { root: '/project', credentials },
    {
      paths: [specification.source.uri],
      scenarioId: 'scnreadybbbbbbbbb',
    },
    config,
    [specification],
  )
  const namedReadiness = await studioRunReadiness(
    { root: '/project', credentials },
    {
      paths: [specification.source.uri],
      scenarioName: 'Locate the customer',
    },
    config,
    [specification],
  )

  expect(exactReadiness.ready).toBe(true)
  expect(namedReadiness.ready).toBe(false)
})

test('maps blocked environment diagnostics into actionable Studio readiness', async () => {
  const readiness = await studioRunReadiness(
    { root: '/project', credentials },
    { paths: [specification.source.uri], scenarioId: 'scnreadybbbbbbbbb' },
    config,
    [specification],
  )

  const mapped = studioRunReadinessWithEnvironment(readiness, {
    ready: false,
    diagnostics: [
      {
        profileIds: ['android'],
        diagnostic: {
          id: 'mobile.android-emulator',
          kind: 'blocked',
          message: 'Android Emulator is not ready',
          remediation: [{ summary: 'Boot an Android Emulator' }],
        },
      },
    ],
    uncheckedProfileIds: [],
  })

  expect(mapped.ready).toBe(false)
  expect(mapped.checks?.at(-1)).toEqual({
    id: 'environment',
    status: 'blocked',
    reasons: ['Android Emulator is not ready. Boot an Android Emulator'],
  })
  expect(mapped.reasons).toContain(
    'Android Emulator is not ready. Boot an Android Emulator',
  )
})
