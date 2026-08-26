import { expect, test } from 'bun:test'
import {
  parseStudioRoute,
  type StudioRoute,
  studioRouteHref,
} from './studio-route'

test('round-trips Runs filters through the global Runs URL', () => {
  const route: StudioRoute = {
    kind: 'runs',
    filters: {
      q: 'checkout run',
      state: 'failed',
      specification: 'features/checkout.feature',
      profile: 'Pixel 9 / API 36',
      suite: 'smoke',
    },
  }

  expect(parseStudioRoute(studioRouteHref(route))).toEqual(route)
})

test('round-trips encoded result identity and evidence tab', () => {
  const route: StudioRoute = {
    kind: 'result',
    location: {
      runId: 'run/78',
      specificationUri: 'features/payment flows.feature',
      scenarioId: 'scenario/pay now',
      examplesRowId: 'row one',
      profileId: 'Pixel 9 / API 36',
      attempt: 2,
      tab: 'diagnostics',
    },
  }

  expect(parseStudioRoute(studioRouteHref(route))).toEqual(route)
})

test('parses the Runs list and run detail routes', () => {
  expect(parseStudioRoute('/runs')).toEqual({ kind: 'runs', filters: {} })
  expect(parseStudioRoute('/runs/run-42')).toEqual({
    kind: 'run',
    runId: 'run-42',
  })
})

test('rejects malformed attempts and unknown Studio paths', () => {
  expect(
    parseStudioRoute(
      '/runs/run-42/results/scenario/chrome/zero?specification=features%2Fcheckout.feature',
    ),
  ).toEqual({ kind: 'not-found' })
  expect(parseStudioRoute('/unknown')).toEqual({ kind: 'not-found' })
})

test('ignores unsupported filter and tab values', () => {
  expect(parseStudioRoute('/runs?state=unknown')).toEqual({
    kind: 'runs',
    filters: {},
  })
  expect(
    parseStudioRoute(
      '/runs/run-42/results/scenario/chrome/1?specification=features%2Fcheckout.feature&tab=unknown',
    ),
  ).toEqual({
    kind: 'result',
    location: {
      runId: 'run-42',
      specificationUri: 'features/checkout.feature',
      scenarioId: 'scenario',
      profileId: 'chrome',
      attempt: 1,
    },
  })
})
