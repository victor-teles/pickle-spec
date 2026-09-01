import type { StudioRunsIndex } from '../history/history.contracts'

export type SpecificationRunReport = {
  href: string
  scope: 'all-specifications' | 'partial'
  specificationUris: readonly string[]
}

type SpecificationRunReportInput = {
  projectSpecificationUris: readonly string[]
  runId?: string
  runsIndex?: StudioRunsIndex
}

export function specificationRunReport(
  input: SpecificationRunReportInput,
): SpecificationRunReport | undefined {
  if (!input.runId || input.runsIndex?.activeRunIds.includes(input.runId)) {
    return
  }

  const summary = input.runsIndex?.runs.find((run) => run.id === input.runId)
  if (!summary?.finishedAt) return

  const projectUris = new Set(input.projectSpecificationUris)
  const reportUris = new Set(summary.specificationUris)
  const coversAllSpecifications =
    projectUris.size > 0 &&
    projectUris.size === reportUris.size &&
    [...projectUris].every((uri) => reportUris.has(uri))

  return {
    href: `/api/history/${encodeURIComponent(input.runId)}/html`,
    scope: coversAllSpecifications ? 'all-specifications' : 'partial',
    specificationUris: summary.specificationUris,
  }
}

export function specificationReportHref(
  report: SpecificationRunReport | undefined,
  specificationUri: string,
): string | undefined {
  return report?.specificationUris.includes(specificationUri)
    ? report.href
    : undefined
}

export function allSpecificationsReportHref(
  report: SpecificationRunReport | undefined,
): string | undefined {
  return report?.scope === 'all-specifications' ? report.href : undefined
}
