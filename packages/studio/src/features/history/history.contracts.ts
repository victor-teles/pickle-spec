import type {
  HtmlArtifactMode,
  TestRunComparison,
  TestRunExportFormat,
  TestRunManifest,
  TestRunStorageInspection,
  TestRunSummary,
} from '@pickle-spec/runner'

type StudioRunReportFormat = Exclude<TestRunExportFormat, 'html'>

export type StudioRunReportRequest =
  | {
      runId: string
      format: 'html'
      htmlArtifacts: HtmlArtifactMode
    }
  | {
      runId: string
      format: StudioRunReportFormat
      htmlArtifacts?: never
    }

export type StudioRunReport = string | Uint8Array

interface StudioRunReportDescriptor {
  format: TestRunExportFormat
  label: string
  contentType: string
  filenameSuffix: string
}

type StudioRunReportMetadata = Omit<StudioRunReportDescriptor, 'format'>
type StudioRunReportMetadataEntry = [
  TestRunExportFormat,
  StudioRunReportMetadata,
]

const studioRunReportMetadataByFormat = {
  json: {
    label: 'JSON report',
    contentType: 'application/json; charset=utf-8',
    filenameSuffix: '.json',
  },
  ndjson: {
    label: 'NDJSON events',
    contentType: 'application/x-ndjson; charset=utf-8',
    filenameSuffix: '.ndjson',
  },
  junit: {
    label: 'JUnit report',
    contentType: 'application/xml; charset=utf-8',
    filenameSuffix: '.xml',
  },
  html: {
    label: 'HTML report',
    contentType: 'text/html; charset=utf-8',
    filenameSuffix: '.html',
  },
  archive: {
    label: 'Run archive',
    contentType: 'application/json; charset=utf-8',
    filenameSuffix: '.pickle-run.json',
  },
  allure: {
    label: 'Allure results',
    contentType: 'application/zip',
    filenameSuffix: '-allure-results.zip',
  },
} as const satisfies Record<TestRunExportFormat, StudioRunReportMetadata>

export const studioRunReportDescriptors = (
  Object.entries(
    studioRunReportMetadataByFormat,
  ) as StudioRunReportMetadataEntry[]
).map(
  ([format, metadata]): StudioRunReportDescriptor => ({
    format,
    ...metadata,
  }),
)

export function studioRunReportDescriptor(
  value: string,
): StudioRunReportDescriptor | undefined {
  return studioRunReportDescriptors.find(({ format }) => format === value)
}

export interface StudioHistoryGateway {
  list(): Promise<StudioHistory>
  compare(
    baselineRunId: string,
    candidateRunId: string,
  ): Promise<TestRunComparison>
  importArchive(bytes: Uint8Array): Promise<TestRunManifest>
  exportReport(request: StudioRunReportRequest): Promise<StudioRunReport>
  deleteEligible(): Promise<{
    removed: string[]
    beforeBytes: number
    afterBytes: number
  }>
  pin(runId: string): Promise<void>
  unpin(runId: string): Promise<void>
}

export interface StudioRetentionPolicy {
  maxAgeMs?: number
  maxBytes?: number
}

export interface StudioHistory {
  runs: readonly TestRunSummary[]
  retention: StudioRetentionPolicy
  storage: TestRunStorageInspection
}

export interface StudioRunsIndex extends StudioHistory {
  activeRunIds: readonly string[]
}
