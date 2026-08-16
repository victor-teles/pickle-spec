import type { RunEvent, TestResult, TestResultState } from './run-scenario'
import type { TestRunManifest } from './test-run-store'

export function formatJson(manifest: TestRunManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function formatNdjson(events: readonly RunEvent[]): string {
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
}

export function formatJunit(manifest: TestRunManifest): string {
  const suites = new Map<string, TestResult[]>()
  for (const result of manifest.results) {
    const name = result.specification.name
    const existing = suites.get(name) ?? []
    existing.push(result)
    suites.set(name, existing)
  }

  const body = [...suites.entries()]
    .map(([name, results]) => formatSuite(name, results))
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites id="${escapeXml(manifest.id)}" name="${escapeXml(manifest.id)}"${counts(manifest.results)}>
${body}
</testsuites>
`
}

function formatSuite(name: string, results: TestResult[]): string {
  const cases = results.map(formatCase).join('\n')
  return `  <testsuite name="${escapeXml(name)}"${counts(results)}>
${cases}
  </testsuite>`
}

function formatCase(result: TestResult): string {
  const attributes = `name="${escapeXml(result.scenario.name)}" classname="${escapeXml(result.specification.uri)}"`
  const children = caseChildren(result)
  if (children.length === 0) {
    return `    <testcase ${attributes}/>`
  }
  return `    <testcase ${attributes}>
${children.join('\n')}
    </testcase>`
}

function caseChildren(result: TestResult): string[] {
  const children: string[] = []
  const properties: string[] = []
  if (result.state === 'passed-with-adaptation') {
    properties.push(
      '        <property name="state" value="passed-with-adaptation"/>',
    )
  }
  if (result.flaky) {
    properties.push('        <property name="flaky" value="true"/>')
  }
  if (properties.length > 0) {
    children.push('      <properties>', ...properties, '      </properties>')
  }
  if (result.state === 'failed') {
    children.push(
      `      <failure message="${escapeXml(result.message ?? '')}"/>`,
    )
  }
  if (result.state === 'skipped') {
    children.push(
      `      <skipped message="${escapeXml(result.message ?? '')}"/>`,
    )
  }
  if (result.state === 'cancelled' || result.state === 'infrastructure-error') {
    children.push(
      `      <error type="${result.state}" message="${escapeXml(result.message ?? '')}"/>`,
    )
  }
  return children
}

function counts(results: readonly TestResult[]): string {
  return ` tests="${results.length}" failures="${count(results, 'failed')}" errors="${count(results, 'cancelled') + count(results, 'infrastructure-error')}" skipped="${count(results, 'skipped')}"`
}

function count(results: readonly TestResult[], state: TestResultState): number {
  return results.filter((result) => result.state === state).length
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
