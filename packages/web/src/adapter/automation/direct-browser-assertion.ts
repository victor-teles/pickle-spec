import type { Locator, Page } from '@browserbasehq/stagehand'
import type { ScenarioVariableBinding } from '@pickle-spec/spec'
import type { WebInstruction } from '../../execution-cache/web-execution-cache'
import {
  boundValue,
  locatorCount,
  waitForLocator,
} from './direct-browser-locator'
import type { WebDirectExecutionResult } from './web-automation'

export function comparison(
  success: boolean,
  expected: string | number | boolean,
  actual: string | number | boolean,
): WebDirectExecutionResult {
  return success
    ? { success: true, actualState: String(actual) }
    : {
        success: false,
        actualState: String(actual),
        message: `Expected ${JSON.stringify(expected)} but received ${JSON.stringify(actual)}`,
      }
}

function countExpectation(
  instruction: Extract<WebInstruction, { kind: 'count-equals' }>,
  bindings: readonly ScenarioVariableBinding[],
): number {
  const expectation = instruction.expected
  const expected =
    typeof expectation === 'number'
      ? expectation
      : Number(
          bindings.find((binding) => binding.name === expectation.variable)
            ?.value,
        )
  if (!Number.isSafeInteger(expected) || expected < 0) {
    throw new Error('Replay count variable must be a non-negative integer')
  }
  return expected
}

async function executeWait(
  page: Page,
  instruction: Extract<WebInstruction, { kind: 'wait-for' }>,
  bindings: readonly ScenarioVariableBinding[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<WebDirectExecutionResult> {
  const success = await waitForLocator(
    page,
    instruction.locator,
    instruction.state,
    bindings,
    timeoutMs,
    signal,
  )
  return success
    ? { success: true }
    : {
        success: false,
        actualState: 'wait timed out',
        message: `Timed out waiting for locator to be ${instruction.state}`,
      }
}

export async function executeLocatorAssertion(
  page: Page,
  instruction: WebInstruction,
  locator: Locator,
  bindings: readonly ScenarioVariableBinding[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<WebDirectExecutionResult> {
  switch (instruction.kind) {
    case 'wait-for':
      return executeWait(page, instruction, bindings, timeoutMs, signal)
    case 'exists': {
      const actual = await locatorCount(page, instruction.locator, bindings)
      const minimum = (instruction.locator.nth ?? 0) + 1
      return comparison(
        actual >= minimum,
        `at least ${minimum} matches`,
        actual,
      )
    }
    case 'visible': {
      const actual = await locator.isVisible()
      return comparison(actual, true, actual)
    }
    case 'hidden': {
      const count = await locatorCount(page, instruction.locator, bindings)
      const actual =
        count <= (instruction.locator.nth ?? 0) || !(await locator.isVisible())
      return comparison(actual, true, actual)
    }
    case 'text-equals': {
      const expected = boundValue(instruction.expected, bindings)
      const actual = await locator.innerText()
      return comparison(actual === expected, expected, actual)
    }
    case 'text-contains': {
      const expected = boundValue(instruction.expected, bindings)
      const actual = await locator.innerText()
      return comparison(actual.includes(expected), expected, actual)
    }
    case 'value-equals': {
      const expected = boundValue(instruction.expected, bindings)
      const actual = await locator.inputValue()
      return comparison(actual === expected, expected, actual)
    }
    case 'count-equals': {
      const expected = countExpectation(instruction, bindings)
      const actual = await locatorCount(page, instruction.locator, bindings)
      return comparison(actual === expected, expected, actual)
    }
    default:
      throw new Error(
        `Unsupported direct browser instruction: ${instruction.kind}`,
      )
  }
}
