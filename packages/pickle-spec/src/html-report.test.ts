import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { generateHtmlReport } from './html-report'
import type { RunResult } from './types'

const fixtureDir = mkdtempSync(join(tmpdir(), 'pickle-html-report-'))

function makeStep(id: string, text: string) {
  return {
    id,
    text,
    astNodeIds: [`${id}-ast`],
  }
}

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    features: [{
      featureFile: '/tmp/example.feature',
      featureName: 'Feature One',
      durationMs: 50,
      scenarios: [{
          pickle: {
            id: 'pickle-1',
            name: 'Scenario One',
            language: 'en',
            uri: 'file:///tmp/example.feature',
            steps: [makeStep('step-1', 'I should see success')],
            tags: [],
            astNodeIds: ['pickle-1-ast'],
          },
        status: 'passed',
        durationMs: 50,
        steps: [{
          step: makeStep('step-1', 'I should see success'),
          status: 'passed',
          durationMs: 50,
        }],
      }],
    }],
    totalDurationMs: 50,
    passed: 1,
    failed: 0,
    skipped: 0,
    artifactsDir: fixtureDir,
    ...overrides,
  }
}

beforeAll(async () => {
  await Bun.write(join(fixtureDir, 'step.png'), 'fake-png-bytes')
  await Bun.write(join(fixtureDir, 'trace.jpeg'), 'fake-jpeg-bytes')
})

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true })
})

describe('generateHtmlReport', () => {
  test('writes report.html and persists reportPath onto the result', async () => {
    const result = makeResult()

    const reportPath = await generateHtmlReport(result)

    expect(reportPath).toBe(join(fixtureDir, 'report.html'))
    expect(result.reportPath).toBe(reportPath)
    expect(await Bun.file(reportPath).exists()).toBe(true)
  })

  test('renders debug asset counts and embedded trace frames when present', async () => {
    const result = makeResult({
      features: [{
        featureFile: '/tmp/example.feature',
        featureName: 'Feature With Artifacts',
        durationMs: 80,
        scenarios: [{
          pickle: {
            id: 'pickle-2',
            name: 'Scenario With Artifacts',
            language: 'en',
            uri: 'file:///tmp/example.feature',
            steps: [makeStep('step-1', 'I should see success')],
            tags: [],
            astNodeIds: ['pickle-2-ast'],
          },
          status: 'failed',
          durationMs: 80,
          steps: [{
            step: makeStep('step-1', 'I should see success'),
            status: 'failed',
            durationMs: 80,
            error: 'Element not found',
            screenshotPath: join(fixtureDir, 'step.png'),
            traceFramePaths: [join(fixtureDir, 'trace.jpeg')],
          }],
        }],
      }],
      passed: 0,
      failed: 1,
    })

    const reportPath = await generateHtmlReport(result)
    const html = await Bun.file(reportPath).text()

    expect(html).toContain('data:image/jpeg;base64,')
    expect(html).toContain('Failure Summary')
    expect(html).toContain('Debug assets:')
    expect(html).toContain('Trace frames: 1')
    expect(html).toContain('Screenshots: 1')
  })

  test('embeds screenshots when no trace frames are available', async () => {
    const result = makeResult({
      features: [{
        featureFile: '/tmp/example.feature',
        featureName: 'Feature With Screenshot',
        durationMs: 80,
        scenarios: [{
          pickle: {
            id: 'pickle-4',
            name: 'Scenario With Screenshot',
            language: 'en',
            uri: 'file:///tmp/example.feature',
            steps: [makeStep('step-1', 'I should see success')],
            tags: [],
            astNodeIds: ['pickle-4-ast'],
          },
          status: 'failed',
          durationMs: 80,
          steps: [{
            step: makeStep('step-1', 'I should see success'),
            status: 'failed',
            durationMs: 80,
            error: 'Screenshot only',
            screenshotPath: join(fixtureDir, 'step.png'),
          }],
        }],
      }],
      passed: 0,
      failed: 1,
    })

    const reportPath = await generateHtmlReport(result)
    const html = await Bun.file(reportPath).text()

    expect(html).toContain('data:image/png;base64,')
  })

  test('renders failed scenarios expanded by default with failure details', async () => {
    const result = makeResult({
      features: [{
        featureFile: '/tmp/example.feature',
        featureName: 'Failed Feature',
        durationMs: 90,
        scenarios: [{
          pickle: {
            id: 'pickle-3',
            name: 'Broken Scenario',
            language: 'en',
            uri: 'file:///tmp/example.feature',
            steps: [makeStep('step-1', 'I should see success')],
            tags: [],
            astNodeIds: ['pickle-3-ast'],
          },
          status: 'failed',
          durationMs: 90,
          steps: [{
            step: makeStep('step-1', 'I should see success'),
            status: 'failed',
            durationMs: 90,
            error: 'Expected success banner',
          }],
        }],
      }],
      passed: 0,
      failed: 1,
    })

    const reportPath = await generateHtmlReport(result)
    const html = await Bun.file(reportPath).text()

    expect(html).toContain('<details class="scenario failed" open>')
    expect(html).toContain('Failed step: I should see success')
    expect(html).toContain('Expected success banner')
  })

  test('summarizes cancelled scenarios when every step is skipped', async () => {
    const result = makeResult({
      features: [{
        featureFile: '/tmp/example.feature',
        featureName: 'Cancelled Feature',
        durationMs: 20,
        scenarios: [{
          pickle: {
            id: 'pickle-cancelled',
            name: 'Cancelled Scenario',
            language: 'en',
            uri: 'file:///tmp/example.feature',
            steps: [makeStep('step-cancelled', 'I finish checkout')],
            tags: [],
            astNodeIds: ['pickle-cancelled-ast'],
          },
          status: 'failed',
          durationMs: 20,
          error: 'Run cancelled by user',
          failureKind: 'cancellation',
          steps: [{
            step: makeStep('step-cancelled', 'I finish checkout'),
            status: 'skipped',
            durationMs: 0,
          }],
        }],
      }],
      passed: 0,
      failed: 1,
      cancelled: true,
    })

    const reportPath = await generateHtmlReport(result)
    const html = await Bun.file(reportPath).text()

    expect(html).toContain('Failure Summary')
    expect(html).toContain('Cancelled Feature / Cancelled Scenario')
    expect(html).toContain('Failed step: I finish checkout')
    expect(html).toContain('Run cancelled by user')
    expect(html).toContain('<details class="scenario failed" open>')
  })
})
