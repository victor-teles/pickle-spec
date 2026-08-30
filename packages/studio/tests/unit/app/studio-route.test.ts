import { describe, expect, test } from 'vitest'
import {
  parseStudioRoute,
  type StudioRoute,
  studioRouteHref,
} from '../../../src/app/studio-route'

describe('Studio route contract', () => {
  const routes = [
    { kind: 'specifications' },
    {
      kind: 'specification',
      specificationId: 'specification/slash space % café',
    },
    {
      kind: 'scenario',
      specificationId: 'specification/slash space % café',
      scenarioId: 'scenario/slash space % 東京',
    },
    {
      kind: 'runs',
      filters: {
        q: 'checkout run',
        state: 'failed',
        specification: 'features/checkout flow %.feature',
        profile: 'Pixel 9 / API 36',
        suite: 'smoke/rápido',
      },
    },
    { kind: 'run', runId: 'run/slash space % 測試' },
    {
      kind: 'result',
      location: {
        runId: 'run/slash space % 測試',
        specificationUri: 'features/payment flows %.feature',
        scenarioId: 'scenario/pay now % 東京',
        profileId: 'Pixel 9 / API 36 %',
        attempt: 2,
        tab: 'diagnostics',
      },
    },
    {
      kind: 'result',
      location: {
        runId: 'run/slash space % 測試',
        specificationUri: 'features/payment flows %.feature',
        scenarioId: 'scenario/pay now % 東京',
        examplesRowId: 'row/slash space % café',
        profileId: 'Pixel 9 / API 36 %',
        attempt: 2,
        tab: 'artifacts',
      },
    },
    {
      kind: 'artifact',
      location: {
        result: {
          runId: 'run/slash space % 測試',
          specificationUri: 'features/payment flows %.feature',
          scenarioId: 'scenario/pay now % 東京',
          examplesRowId: 'row/slash space % café',
          profileId: 'Pixel 9 / API 36 %',
          attempt: 2,
          tab: 'timeline',
        },
        artifactIndex: 0,
      },
    },
  ] satisfies Exclude<StudioRoute, { kind: 'not-found' }>[]

  for (const route of routes) {
    test(`round-trips ${route.kind}`, () => {
      expect(parseStudioRoute(studioRouteHref(route))).toEqual(route)
    })
  }

  test('writes the canonical entity grammar', () => {
    expect(
      studioRouteHref({
        kind: 'scenario',
        specificationId: 'features/checkout.feature',
        scenarioId: 'pay now',
      }),
    ).toBe('/specifications/features%2Fcheckout.feature/scenarios/pay%20now')
    expect(
      studioRouteHref({
        kind: 'result',
        location: {
          runId: 'run-42',
          specificationUri: 'features/checkout.feature',
          scenarioId: 'scenario-pay',
          examplesRowId: 'row-2',
          profileId: 'chrome desktop',
          attempt: 3,
          tab: 'timeline',
        },
      }),
    ).toBe(
      '/runs/run-42/results/features%2Fcheckout.feature/scenarios/scenario-pay/examples/row-2/profiles/chrome%20desktop/attempts/3?tab=timeline',
    )
  })

  test('parses valid presentation queries without moving identity out of the path', () => {
    expect(
      parseStudioRoute(
        '/runs?state=passed&specification=features%2Fcheckout.feature&profile=chrome&suite=smoke&q=run%2042',
      ),
    ).toEqual({
      kind: 'runs',
      filters: {
        state: 'passed',
        specification: 'features/checkout.feature',
        profile: 'chrome',
        suite: 'smoke',
        q: 'run 42',
      },
    })
    expect(
      parseStudioRoute(
        '/runs/run-42/results/features%2Fcheckout.feature/scenarios/scenario-pay/profiles/chrome/attempts/1?tab=overview',
      ),
    ).toEqual({
      kind: 'result',
      location: {
        runId: 'run-42',
        specificationUri: 'features/checkout.feature',
        scenarioId: 'scenario-pay',
        profileId: 'chrome',
        attempt: 1,
        tab: 'overview',
      },
    })
  })

  test('ignores unsupported Runs filters and result tabs', () => {
    expect(parseStudioRoute('/runs?state=unknown')).toEqual({
      kind: 'runs',
      filters: {},
    })
    expect(
      parseStudioRoute(
        '/runs/run-42/results/features%2Fcheckout.feature/scenarios/scenario-pay/profiles/chrome/attempts/1?tab=unknown',
      ),
    ).toEqual({
      kind: 'result',
      location: {
        runId: 'run-42',
        specificationUri: 'features/checkout.feature',
        scenarioId: 'scenario-pay',
        profileId: 'chrome',
        attempt: 1,
      },
    })
  })

  const rejectedPaths = [
    '/unknown',
    '/index.html',
    '/specifications/',
    '/specifications/specification/scenarios',
    '/specifications/specification/scenarios/',
    '/specifications/specification/scenarios/scenario/trailing',
    '/runs/',
    '/runs/run-42/',
    '/runs/run-42/results',
    '/runs/run-42/results/specification/scenarios/scenario/profiles/chrome/attempts',
    '/runs/run-42/results/specification/scenarios/scenario/profiles/chrome/attempts/0',
    '/runs/run-42/results/specification/scenarios/scenario/profiles/chrome/attempts/-1',
    '/runs/run-42/results/specification/scenarios/scenario/profiles/chrome/attempts/1.5',
    '/runs/run-42/results/specification/scenarios/scenario/profiles/chrome/attempts/NaN',
    '/runs/run-42/results/specification/scenarios/scenario/examples/row/profiles/chrome/attempts/1/artifacts/-1',
    '/runs/run-42/results/specification/scenarios/scenario/examples/row/profiles/chrome/attempts/1/artifacts/1.5',
    '/runs/run-42/results/specification/scenarios/scenario/examples/row/profiles/chrome/attempts/1/artifacts/NaN',
    '/runs/run-42/results/specification/scenarios/scenario/examples/row/profiles/chrome/attempts/1/artifacts/0/trailing',
    '/runs/run-42/results/scenario/chrome/1?specification=features%2Fcheckout.feature',
    '/runs/run-42/results/specification/scenarios/scenario/profiles/chrome/attempts/1?specification=legacy',
    '/runs/run-42/results/specification/scenarios/scenario/profiles/chrome/attempts/1?examplesRow=legacy',
    '/runs/%E0%A4%A',
    '/specifications/%E0%A4%A',
  ]

  for (const path of rejectedPaths) {
    test(`rejects ${path}`, () => {
      expect(parseStudioRoute(path)).toEqual({ kind: 'not-found' })
    })
  }
})
