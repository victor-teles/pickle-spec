import { dirname, join, resolve } from 'path'
import { mkdir } from 'node:fs/promises'
import type { FailureKind, PickleSpecConfig, RunResult, ScenarioResult, StepResult } from './types'

const DEFAULT_OUTPUT_DIR = '.pickle/results'

function escapeXml(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0)!
      return codePoint === 0x09
        || codePoint === 0x0a
        || codePoint === 0x0d
        || (codePoint >= 0x20 && codePoint <= 0xd7ff)
        || (codePoint >= 0xe000 && codePoint <= 0xfffd)
        || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
    })
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(3)
}

function getFailureMessage(scenario: ScenarioResult): string {
  return scenario.error ?? scenario.steps.find(step => step.status === 'failed')?.error ?? 'Unknown failure'
}

function buildAttemptSummary(scenario: ScenarioResult): string | undefined {
  if (!scenario.attemptResults || scenario.attemptResults.length <= 1) return undefined

  return scenario.attemptResults
    .map((attempt, index) => {
      const detail = attempt.error ? `: ${attempt.error}` : ''
      return `Attempt ${index + 1}: ${attempt.status}${attempt.failureKind ? ` (${attempt.failureKind})` : ''}${detail}`
    })
    .join('\n')
}

function countJunitFailures(scenarios: ScenarioResult[], kind: FailureKind): number {
  return scenarios.filter(scenario => scenario.status === 'failed' && scenario.failureKind === kind).length
}

function buildJunitCase(scenario: ScenarioResult): string {
  let xml = `<testcase name="${escapeXml(scenario.pickle.name)}" time="${formatSeconds(scenario.durationMs)}">`

  if (scenario.status === 'skipped') {
    xml += '<skipped />'
  } else if (scenario.status === 'failed') {
    const message = escapeXml(getFailureMessage(scenario))
    const node = scenario.failureKind === 'assertion' ? 'failure' : 'error'
    xml += `<${node} message="${message}">${message}</${node}>`
  }

  if (scenario.flaky || (scenario.attemptResults && scenario.attemptResults.length > 1)) {
    xml += `<system-out>${escapeXml(buildAttemptSummary(scenario) ?? '')}</system-out>`
  }

  xml += '</testcase>'
  return xml
}

export function resolveOutputPaths(config: PickleSpecConfig): { json?: string; junit?: string } {
  return {
    json: config.output?.json === false
      ? undefined
      : config.output?.json?.path ?? (config.output?.json ? join(DEFAULT_OUTPUT_DIR, 'run.json') : undefined),
    junit: config.output?.junit === false
      ? undefined
      : config.output?.junit?.path ?? (config.output?.junit ? join(DEFAULT_OUTPUT_DIR, 'junit.xml') : undefined),
  }
}

export function buildJsonOutput(result: RunResult): string {
  const output = {
    summary: {
      passed: result.passed,
      failed: result.failed,
      skipped: result.skipped,
      cancelled: result.cancelled ?? false,
      durationMs: result.totalDurationMs,
    },
    reportPath: result.reportPath,
    selection: result.selection,
    server: result.server,
    features: result.features,
  }

  return JSON.stringify(output, null, 2)
}

export function buildJunitOutput(result: RunResult): string {
  const scenarios = result.features.flatMap(feature => feature.scenarios)
  let xml = '<?xml version="1.0" encoding="UTF-8"?>'
  xml += `<testsuites tests="${scenarios.length}" failures="${countJunitFailures(scenarios, 'assertion')}" errors="${countJunitFailures(scenarios, 'infrastructure') + countJunitFailures(scenarios, 'cancellation')}" skipped="${result.skipped}" time="${formatSeconds(result.totalDurationMs)}">`

  for (const feature of result.features) {
    xml += `<testsuite name="${escapeXml(feature.featureName)}" tests="${feature.scenarios.length}" failures="${countJunitFailures(feature.scenarios, 'assertion')}" errors="${countJunitFailures(feature.scenarios, 'infrastructure') + countJunitFailures(feature.scenarios, 'cancellation')}" skipped="${feature.scenarios.filter(scenario => scenario.status === 'skipped').length}" time="${formatSeconds(feature.durationMs)}">`
    for (const scenario of feature.scenarios) {
      xml += buildJunitCase(scenario)
    }
    xml += '</testsuite>'
  }

  xml += '</testsuites>'
  return xml
}

export async function writeStructuredOutputs(result: RunResult, config: PickleSpecConfig): Promise<string[]> {
  const paths = resolveOutputPaths(config)
  const written: string[] = []

  if (paths.json && paths.junit && resolve(paths.json) === resolve(paths.junit)) {
    throw new Error('JSON and JUnit output paths must be different')
  }

  if (paths.json) {
    await mkdir(dirname(paths.json), { recursive: true })
    await Bun.write(paths.json, buildJsonOutput(result))
    written.push(paths.json)
  }

  if (paths.junit) {
    await mkdir(dirname(paths.junit), { recursive: true })
    await Bun.write(paths.junit, buildJunitOutput(result))
    written.push(paths.junit)
  }

  return written
}
