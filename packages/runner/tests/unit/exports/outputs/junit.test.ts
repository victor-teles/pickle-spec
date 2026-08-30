import { expect, test } from 'vitest'
import { formatJunit } from '../../../../index'
import type { TestRunManifest } from '../../../../src/results/test-run-store'
import { manifest, result } from './fixtures'

test('formats JUnit XML with cache metadata, stable states, flaky, and error classes', () => {
  const junitManifest: TestRunManifest = {
    ...manifest,
    results: [
      result('Complete a purchase', 'passed', {
        attempt: {
          executionMode: 'replay',
          cacheOutcome: 'hit',
          inferenceCount: 0,
        },
      }),
      result('Adapt the purchase', 'passed', {
        attempt: {
          executionMode: 'adaptive',
          cacheOutcome: 'fallback',
          inferenceCount: 3,
        },
      }),
      ...manifest.results.slice(2),
    ],
  }
  expect(
    formatJunit(junitManifest),
  ).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<testsuites id="run-ci" name="run-ci" tests="7" failures="1" errors="2" skipped="1">
  <testsuite name="Checkout" tests="7" failures="1" errors="2" skipped="1">
    <testcase name="Complete a purchase" classname="features/checkout.feature">
      <properties>
        <property name="execution-mode" value="replay"/>
        <property name="cache-outcome" value="hit"/>
        <property name="inference-count" value="0"/>
      </properties>
    </testcase>
    <testcase name="Adapt the purchase" classname="features/checkout.feature">
      <properties>
        <property name="execution-mode" value="adaptive"/>
        <property name="cache-outcome" value="fallback"/>
        <property name="inference-count" value="3"/>
      </properties>
    </testcase>
    <testcase name="Retry the purchase" classname="features/checkout.feature">
      <properties>
        <property name="flaky" value="true"/>
      </properties>
    </testcase>
    <testcase name="Pay for the order" classname="features/checkout.feature">
      <failure message="Payment was declined"/>
    </testcase>
    <testcase name="Skip the purchase" classname="features/checkout.feature">
      <skipped message="Scenario is tagged @ignore"/>
    </testcase>
    <testcase name="Cancel the purchase" classname="features/checkout.feature">
      <error type="cancelled" message="Scenario cancelled"/>
    </testcase>
    <testcase name="Open the storefront" classname="features/checkout.feature">
      <error type="infrastructure-error" message="Browser process exited"/>
    </testcase>
  </testsuite>
</testsuites>
`)
})

test('exposes uncacheable and cache-only failure metadata in JUnit properties', () => {
  const uncacheable = result('Adaptive checkout', 'passed', {
    attempt: {
      executionMode: 'adaptive',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'non-deterministic-action',
      inferenceCount: 2,
    },
  })
  const cacheMiss = result('Replay checkout', 'failed', {
    attempt: {
      executionMode: 'replay',
      cacheOutcome: 'miss',
      failureKind: 'cache-miss',
      inferenceCount: 0,
    },
  })
  const xml = formatJunit({ ...manifest, results: [uncacheable, cacheMiss] })

  expect(xml).toContain(
    '<property name="cache-uncacheable-reason" value="non-deterministic-action"/>',
  )
  expect(xml).toContain('<property name="failure-kind" value="cache-miss"/>')
  expect(xml).toContain('<property name="inference-count" value="0"/>')
})
