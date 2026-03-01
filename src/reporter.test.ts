import { test, expect, describe, beforeEach, afterEach, spyOn } from 'bun:test'
import {
  reportFeatureStart,
  reportScenarioStart,
  reportStepResult,
  reportSummary,
  reportError,
} from './reporter'
import type { StepResult, RunResult } from './types'
import { PickleStep } from '@cucumber/messages'

let logOutput: string[]
let errorOutput: string[]
let logSpy: ReturnType<typeof spyOn>
let errorSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  logOutput = []
  errorOutput = []
  logSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logOutput.push(args.map(String).join(' '))
  })
  errorSpy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errorOutput.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
})

const mockStep: PickleStep = {
  text: 'I click the button',
  id: 'step-1',
  astNodeIds: ['ast-1'],
}

describe('reportFeatureStart', () => {
  test('outputs feature name and file path', () => {
    reportFeatureStart('Login Feature', '/path/to/login.feature')
    const output = logOutput.join('\n')
    expect(output).toContain('Login Feature')
    expect(output).toContain('/path/to/login.feature')
  })
})

describe('reportScenarioStart', () => {
  test('outputs scenario name', () => {
    reportScenarioStart('Valid login')
    const output = logOutput.join('\n')
    expect(output).toContain('Valid login')
  })
})

describe('reportStepResult', () => {
  test('outputs passed step', () => {
    const result: StepResult = { step: mockStep, status: 'passed', durationMs: 42 }
    reportStepResult('Given ', 'I click the button', result)
    const output = logOutput.join('\n')
    expect(output).toContain('Given ')
    expect(output).toContain('I click the button')
    expect(output).toContain('42ms')
  })

  test('outputs failed step with error', () => {
    const result: StepResult = {
      step: mockStep,
      status: 'failed',
      durationMs: 100,
      error: 'Element not found',
    }
    reportStepResult('When ', 'I click the button', result)
    const output = logOutput.join('\n')
    expect(output).toContain('When ')
    expect(output).toContain('I click the button')
    expect(output).toContain('Element not found')
  })

  test('outputs skipped step', () => {
    const result: StepResult = { step: mockStep, status: 'skipped', durationMs: 0 }
    reportStepResult('Then ', 'I see the result', result)
    const output = logOutput.join('\n')
    expect(output).toContain('Then ')
    expect(output).toContain('I see the result')
    expect(output).toContain('skipped')
  })
})

describe('reportSummary', () => {
  test('outputs all passed summary', () => {
    const result: RunResult = {
      features: [],
      totalDurationMs: 1500,
      passed: 3,
      failed: 0,
      skipped: 0,
    }
    reportSummary(result)
    const output = logOutput.join('\n')
    expect(output).toContain('3 scenario(s) passed')
    expect(output).toContain('1.5s')
  })

  test('outputs mixed results summary', () => {
    const result: RunResult = {
      features: [],
      totalDurationMs: 5000,
      passed: 2,
      failed: 1,
      skipped: 1,
    }
    reportSummary(result)
    const output = logOutput.join('\n')
    expect(output).toContain('4 scenario(s)')
    expect(output).toContain('2 passed')
    expect(output).toContain('1 failed')
    expect(output).toContain('1 skipped')
  })
})

describe('reportError', () => {
  test('outputs to stderr', () => {
    reportError('Something went wrong')
    const output = errorOutput.join('\n')
    expect(output).toContain('Something went wrong')
  })
})
