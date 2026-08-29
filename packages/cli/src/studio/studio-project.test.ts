import { expect, test } from 'bun:test'
import { parseSpecification } from '@pickle-spec/spec'
import type { CredentialStore } from '@pickle-spec/studio'
import type { PickleConfig } from '../configuration/config'
import { studioRunReadiness } from './studio-project'

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
    ['mobile-target', 'not-applicable'],
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
