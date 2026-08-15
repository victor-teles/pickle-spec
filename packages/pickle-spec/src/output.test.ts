import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildJunitOutput, resolveOutputPaths, writeStructuredOutputs } from './output'
import type { PickleSpecConfig, RunResult } from './types'

const fixtureDir = mkdtempSync(join(tmpdir(), 'pickle-output-'))

function makeStep(id: string, text: string) {
  return {
    id,
    text,
    astNodeIds: [`${id}-ast`],
  }
}

function makeScenario(name: string, overrides: Record<string, unknown> = {}) {
  return {
    pickle: {
      id: `${name}-id`,
      name,
      language: 'en',
      uri: `file:///tmp/${name}.feature`,
      steps: [makeStep(`${name}-step`, 'I do something')],
      tags: [],
      astNodeIds: [`${name}-ast`],
    },
    status: 'passed' as const,
    durationMs: 25,
    steps: [{
      step: makeStep(`${name}-step`, 'I do something'),
      status: 'passed' as const,
      durationMs: 25,
    }],
    attempts: 1,
    flaky: false,
    attemptResults: [{ status: 'passed' as const, durationMs: 25 }],
    ...overrides,
  }
}

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    features: [{
      featureFile: '/tmp/feature.feature',
      featureName: 'Feature One',
      durationMs: 50,
      scenarios: [makeScenario('Scenario One')],
    }],
    totalDurationMs: 50,
    passed: 1,
    failed: 0,
    skipped: 0,
    reportPath: '/tmp/report.html',
    ...overrides,
  }
}

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true })
})

describe('resolveOutputPaths', () => {
  test('uses default result paths when outputs are enabled without explicit paths', () => {
    const config: PickleSpecConfig = {
      output: {
        json: {},
        junit: {},
      },
    }

    expect(resolveOutputPaths(config)).toEqual({
      json: '.pickle/results/run.json',
      junit: '.pickle/results/junit.xml',
    })
  })
})

describe('writeStructuredOutputs', () => {
  test('writes JSON and JUnit outputs to configured paths', async () => {
    const jsonPath = join(fixtureDir, 'run.json')
    const junitPath = join(fixtureDir, 'junit.xml')
    const result = makeResult({
      selection: {
        scenarioName: 'scenario',
        tagExpression: '@smoke',
        shard: { index: 1, total: 2 },
      },
      server: {
        mode: 'reused',
        url: 'http://localhost:3000',
      },
    })

    const written = await writeStructuredOutputs(result, {
      output: {
        json: { path: jsonPath },
        junit: { path: junitPath },
      },
    })

    expect(written).toEqual([jsonPath, junitPath])

    const json = JSON.parse(await Bun.file(jsonPath).text())
    expect(json.summary).toEqual({
      passed: 1,
      failed: 0,
      skipped: 0,
      cancelled: false,
      durationMs: 50,
    })
    expect(json.selection).toEqual(result.selection)
    expect(json.server).toEqual(result.server)
    expect(json.reportPath).toBe('/tmp/report.html')
    expect(await Bun.file(junitPath).text()).toContain('<testsuite name="Feature One"')
  })

  test('rejects duplicate resolved output paths before writing either format', async () => {
    const outputPath = join(fixtureDir, 'duplicate-output')
    rmSync(outputPath, { force: true })

    await expect(writeStructuredOutputs(makeResult(), {
      output: {
        json: { path: outputPath },
        junit: { path: `${fixtureDir}/nested/../duplicate-output` },
      },
    })).rejects.toThrow('JSON and JUnit output paths must be different')

    expect(await Bun.file(outputPath).exists()).toBe(false)
  })
})

describe('buildJunitOutput', () => {
  test('uses failure vs error nodes based on failure classification and includes flaky details', () => {
    const result = makeResult({
      features: [{
        featureFile: '/tmp/feature.feature',
        featureName: 'Feature One',
        durationMs: 100,
        scenarios: [
          makeScenario('Assertion failure', {
            status: 'failed',
            error: 'Expected banner',
            failureKind: 'assertion',
            steps: [{
              step: makeStep('assert-step', 'I should see banner'),
              status: 'failed',
              durationMs: 20,
              error: 'Expected banner',
              failureKind: 'assertion',
            }],
            attemptResults: [{ status: 'failed', durationMs: 20, error: 'Expected banner', failureKind: 'assertion' }],
          }),
          makeScenario('Infra failure', {
            status: 'failed',
            error: 'browser crashed',
            failureKind: 'infrastructure',
            steps: [{
              step: makeStep('infra-step', 'I click checkout'),
              status: 'failed',
              durationMs: 20,
              error: 'browser crashed',
              failureKind: 'infrastructure',
            }],
            attemptResults: [{ status: 'failed', durationMs: 20, error: 'browser crashed', failureKind: 'infrastructure' }],
          }),
          makeScenario('Flaky pass', {
            status: 'passed',
            flaky: true,
            attempts: 2,
            attemptResults: [
              { status: 'failed', durationMs: 10, error: 'net::ERR_ABORTED', failureKind: 'infrastructure' },
              { status: 'passed', durationMs: 15 },
            ],
          }),
        ],
      }],
      totalDurationMs: 100,
      passed: 1,
      failed: 2,
    })

    const xml = buildJunitOutput(result)

    expect(xml).toContain('<failure message="Expected banner">')
    expect(xml).toContain('<error message="browser crashed">')
    expect(xml).toContain('Attempt 1: failed (infrastructure): net::ERR_ABORTED')
  })

  test('removes XML-invalid characters before escaping JUnit values', () => {
    const result = makeResult({
      features: [{
        featureFile: '/tmp/feature.feature',
        featureName: 'Feature\u0000 One',
        durationMs: 25,
        scenarios: [makeScenario('Scenario\u000b One', {
          status: 'failed',
          error: 'Bad\u000c value & <detail>',
          failureKind: 'infrastructure',
        })],
      }],
      passed: 0,
      failed: 1,
    })

    const xml = buildJunitOutput(result)

    expect(xml).not.toContain('\u0000')
    expect(xml).not.toContain('\u000b')
    expect(xml).not.toContain('\u000c')
    expect(xml).toContain('Feature One')
    expect(xml).toContain('Scenario One')
    expect(xml).toContain('Bad value &amp; &lt;detail&gt;')
  })
})
