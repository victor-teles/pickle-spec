import { expect, test } from 'bun:test'
import {
  type ClientEvent,
  emptyRunView,
  pinCell,
  reduceRun,
  statusLabel,
  type TestResult,
} from './run-view'

function started(name: string, id: string, profileId = 'chrome'): ClientEvent {
  return {
    type: 'scenario-started',
    scenario: { name, id },
    executionTargetProfile: { id: profileId },
  }
}

function finished(
  name: string,
  id: string,
  state: TestResult['state'],
  profileId = 'chrome',
): ClientEvent {
  return {
    type: 'scenario-finished',
    scenario: { name, id },
    executionTargetProfile: { id: profileId },
    attempt: {
      state,
      steps: [],
    },
  }
}

test('follows the first running cell until a failure needs attention', () => {
  let view = reduceRun(emptyRunView(), started('Complete a purchase', 'pass'))
  view = reduceRun(view, started('Pay for the order', 'pay'))
  expect(view.selected?.scenarioName).toBe('Complete a purchase')
  view = reduceRun(view, finished('Pay for the order', 'pay', 'failed'))
  expect(view.selected?.scenarioName).toBe('Pay for the order')
  expect(view.selected?.state).toBe('failed')
})

test('keeps a pinned cell when a later failure arrives', () => {
  let view = reduceRun(emptyRunView(), started('Complete a purchase', 'pass'))
  view = pinCell(view, view.selected!)
  view = reduceRun(view, started('Pay for the order', 'pay'))
  view = reduceRun(view, finished('Pay for the order', 'pay', 'failed'))
  expect(view.selected?.scenarioName).toBe('Complete a purchase')
  expect(view.pinned).toBe(true)
})

test('prefers a failed cell over a passed cell when unpinned', () => {
  let view = reduceRun(emptyRunView(), started('Review the purchase', 'review'))
  view = reduceRun(view, finished('Review the purchase', 'review', 'passed'))
  expect(view.selected?.state).toBe('passed')
  view = reduceRun(view, started('Pay for the order', 'pay'))
  view = reduceRun(view, finished('Pay for the order', 'pay', 'failed'))
  expect(view.selected?.scenarioName).toBe('Pay for the order')
})

test('status stays idle until a run starts', () => {
  expect(statusLabel(emptyRunView())).toBe('idle')
})
