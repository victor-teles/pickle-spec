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
    result: {
      scenario: { name, id },
      executionTargetProfile: { id: profileId },
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

test('prefers a failed cell over an Adaptation when unpinned', () => {
  let view = reduceRun(emptyRunView(), started('Adapt the purchase', 'adapt'))
  view = reduceRun(
    view,
    finished('Adapt the purchase', 'adapt', 'passed-with-adaptation'),
  )
  expect(view.selected?.state).toBe('passed-with-adaptation')
  view = reduceRun(view, started('Pay for the order', 'pay'))
  view = reduceRun(view, finished('Pay for the order', 'pay', 'failed'))
  expect(view.selected?.scenarioName).toBe('Pay for the order')
})

test('status stays idle until a run starts', () => {
  expect(statusLabel(emptyRunView())).toBe('idle')
})
