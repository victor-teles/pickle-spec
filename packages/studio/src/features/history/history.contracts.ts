import type {
  HtmlArtifactMode,
  TestRunComparison,
  TestRunManifest,
  TestRunStorageInspection,
  TestRunSummary,
} from '@pickle-spec/runner'

export interface StudioHistoryGateway {
  list(): Promise<StudioHistory>
  compare(
    baselineRunId: string,
    candidateRunId: string,
  ): Promise<TestRunComparison>
  importArchive(bytes: Uint8Array): Promise<TestRunManifest>
  exportArchive(runId: string): Promise<string>
  exportHtml(runId: string, artifacts: HtmlArtifactMode): Promise<string>
  exportAllure(runId: string): Promise<Uint8Array>
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
