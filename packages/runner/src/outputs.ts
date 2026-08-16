import type { RunEvent, TestResult, TestResultState } from './run-scenario'
import type { TestRunManifest } from './test-run-store'

export function formatJson(manifest: TestRunManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function formatNdjson(events: readonly RunEvent[]): string {
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
}

export type HtmlArtifactMode = 'failures-and-adaptations' | 'all'

export interface FormatHtmlOptions {
  artifacts?: HtmlArtifactMode
}

const priorityStates = new Set<TestResultState>([
  'failed',
  'infrastructure-error',
  'passed-with-adaptation',
  'cancelled',
])

function shouldEmbedArtifacts(
  state: TestResultState,
  mode: HtmlArtifactMode,
): boolean {
  if (mode === 'all') return true
  return (
    state === 'failed' ||
    state === 'passed-with-adaptation' ||
    state === 'infrastructure-error'
  )
}

function resultPriority(state: TestResultState): number {
  if (state === 'failed' || state === 'infrastructure-error') return 0
  if (state === 'passed-with-adaptation') return 1
  if (state === 'cancelled') return 2
  if (state === 'skipped') return 4
  return 3
}

async function embedArtifacts(
  result: TestResult,
  mode: HtmlArtifactMode,
): Promise<string> {
  if (!shouldEmbedArtifacts(result.state, mode)) return ''
  const parts: string[] = []
  for (const step of result.steps) {
    for (const artifact of step.artifacts ?? []) {
      if (!(await Bun.file(artifact.path).exists())) continue
      const bytes = Buffer.from(await Bun.file(artifact.path).arrayBuffer())
      const mediaType = artifact.mediaType ?? 'application/octet-stream'
      const href = `data:${mediaType};base64,${bytes.toString('base64')}`
      if (mediaType.startsWith('image/')) {
        parts.push(
          `<figure><img alt="${escapeXml(artifact.kind)}" src="${href}"/></figure>`,
        )
      } else {
        parts.push(`<p><a href="${href}">${escapeXml(artifact.kind)}</a></p>`)
      }
    }
  }
  return parts.join('\n')
}

export async function formatHtml(
  manifest: TestRunManifest,
  _events: readonly RunEvent[],
  options: FormatHtmlOptions = {},
): Promise<string> {
  const mode = options.artifacts ?? 'failures-and-adaptations'
  const results = [...manifest.results].sort(
    (left, right) =>
      resultPriority(left.state) - resultPriority(right.state) ||
      left.scenario.name.localeCompare(right.scenario.name),
  )
  const sections = await Promise.all(
    results.map(async (result) => {
      const artifacts = await embedArtifacts(result, mode)
      const highlight = priorityStates.has(result.state)
        ? ' class="priority"'
        : ''
      return `<section${highlight}>
  <h2>${escapeXml(result.scenario.name)}</h2>
  <p>State: ${escapeXml(result.state)}</p>
  <p>Profile: ${escapeXml(result.executionTargetProfile.id)}</p>
  ${result.message ? `<p>${escapeXml(result.message)}</p>` : ''}
  ${artifacts}
</section>`
    }),
  )

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Test run ${escapeXml(manifest.id)}</title>
  <style>
    body { font-family: sans-serif; margin: 2rem; }
    section { border: 1px solid #ddd; padding: 1rem; margin-bottom: 1rem; }
    section.priority { border-color: #b00; }
    img { max-width: 100%; }
  </style>
</head>
<body>
  <h1>Test run ${escapeXml(manifest.id)}</h1>
  <p>State: ${escapeXml(manifest.state)}</p>
  ${sections.join('\n')}
</body>
</html>
`
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
<testsuites id="${escapeXml(manifest.id)}" name="${escapeXml(manifest.id)}"${countAttributes(manifest.results)}>
${body}
</testsuites>
`
}

function formatSuite(name: string, results: TestResult[]): string {
  const cases = results.map(formatCase).join('\n')
  return `  <testsuite name="${escapeXml(name)}"${countAttributes(results)}>
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
  const properties = caseProperties(result)
  if (properties.length > 0) {
    children.push('      <properties>', ...properties, '      </properties>')
  }
  const outcome = outcomeElement(result)
  if (outcome) children.push(outcome)
  return children
}

function caseProperties(result: TestResult): string[] {
  const properties: string[] = []
  if (result.state === 'passed-with-adaptation') {
    properties.push(
      '        <property name="state" value="passed-with-adaptation"/>',
    )
  }
  if (result.flaky) {
    properties.push('        <property name="flaky" value="true"/>')
  }
  return properties
}

function outcomeElement(result: TestResult): string | undefined {
  const message = escapeXml(result.message ?? '')
  const outcomes: Partial<Record<TestResultState, string>> = {
    failed: `      <failure message="${message}"/>`,
    skipped: `      <skipped message="${message}"/>`,
    cancelled: `      <error type="cancelled" message="${message}"/>`,
    'infrastructure-error': `      <error type="infrastructure-error" message="${message}"/>`,
  }
  return outcomes[result.state]
}

function countAttributes(results: readonly TestResult[]): string {
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
