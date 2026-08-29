import { expect, test } from 'bun:test'
import type { TestRunSummary } from '@pickle-spec/runner'
import { requiredValue } from '../required-value'
import type {
  StudioProject,
  StudioRunReadiness,
  StudioRunsIndex,
} from '../server/server'
import {
  firstRunOnboardingState,
  firstRunTarget,
} from './first-run-onboarding-model'

const ready: StudioRunReadiness = { ready: true, reasons: [] }
const blocked: StudioRunReadiness = {
  ready: false,
  reasons: ['Add an execution target'],
}

const project: StudioProject = {
  name: 'shop',
  root: '/shop',
  profiles: ['chrome'],
  suites: [],
  specifications: [
    {
      id: 'checkout',
      name: 'Checkout',
      uri: 'features/checkout.feature',
      scenarios: [
        { id: 'blocked', name: 'Blocked', readiness: blocked },
        { id: 'pay', name: 'Pay', readiness: ready },
      ],
    },
    {
      id: 'account',
      name: 'Account',
      uri: 'features/account.feature',
      scenarios: [{ id: 'sign-in', name: 'Sign in', readiness: ready }],
    },
  ],
}
const checkout = requiredValue(project.specifications[0])

function summary(state: TestRunSummary['state']): TestRunSummary {
  return {
    id: `run-${state}`,
    startedAt: '2026-08-28T12:00:00.000Z',
    state,
    executionTargetProfileIds: ['chrome'],
    specificationUris: ['features/checkout.feature'],
    resultCount: 1,
  }
}

function runs(...items: TestRunSummary[]): StudioRunsIndex {
  return {
    runs: items,
    activeRunIds: [],
    retention: {},
    storage: {
      totalBytes: 0,
      warningThresholdBytes: 1,
      warning: false,
      pinnedRunIds: [],
    },
  }
}

test('chooses the current runnable Scenario and builds one exact request', () => {
  const target = firstRunTarget({
    activeProfileId: 'chrome',
    currentSpecification: checkout,
    project,
    running: false,
  })

  expect(target?.scenario.id).toBe('pay')
  expect(target?.request).toEqual({
    paths: ['features/checkout.feature'],
    scenarioId: 'pay',
    profiles: ['chrome'],
  })
})

test('falls back through the catalog when the current Specification is blocked', () => {
  const current = {
    ...checkout,
    scenarios: [{ id: 'blocked', name: 'Blocked', readiness: blocked }],
  }
  const target = firstRunTarget({
    currentSpecification: current,
    project,
    running: false,
  })

  expect(target?.scenario.id).toBe('sign-in')
})

test('models empty, blocked, ready, running, failed, and complete states', () => {
  const emptyProject = { ...project, specifications: [] }
  const blockedProject = {
    ...project,
    specifications: [
      {
        ...checkout,
        scenarios: [{ id: 'blocked', name: 'Blocked', readiness: blocked }],
      },
    ],
  }

  expect(
    firstRunOnboardingState({
      project: emptyProject,
      running: false,
    }).kind,
  ).toBe('empty-project')
  expect(
    firstRunOnboardingState({ project: blockedProject, running: false }).kind,
  ).toBe('blocked')
  expect(firstRunOnboardingState({ project, running: false }).kind).toBe(
    'ready',
  )
  expect(firstRunOnboardingState({ project, running: true }).kind).toBe(
    'running',
  )
  expect(
    firstRunOnboardingState({
      project,
      running: false,
      runsIndex: runs(summary('failed')),
    }).kind,
  ).toBe('failed')
  expect(
    firstRunOnboardingState({
      project,
      running: false,
      runsIndex: runs(summary('passed')),
    }).kind,
  ).toBe('complete')
})

test('uses matching click-time readiness without leaking it to another target', () => {
  const target = firstRunTarget({
    project,
    running: false,
    readinessAttempt: {
      request: {
        paths: ['features/checkout.feature'],
        scenarioId: 'pay',
      },
      readiness: blocked,
    },
  })
  const otherTarget = firstRunTarget({
    activeProfileId: 'chrome',
    project,
    running: false,
    readinessAttempt: {
      request: {
        paths: ['features/checkout.feature'],
        scenarioId: 'pay',
      },
      readiness: blocked,
    },
  })

  expect(target?.readiness).toBe(blocked)
  expect(otherTarget?.readiness).toBe(ready)
})
