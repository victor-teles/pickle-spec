import type { TestArtifact } from '@pickle-spec/runner'
import type { TimelineEntry } from '../runs/result/result-evidence'

type BrowserFrameCandidate = {
  artifact: TestArtifact
  entryId: string
  occurredAt: string
}

export type WorkbenchBrowserFrame = {
  artifact: TestArtifact
  exact: boolean
}

function screenshotsFor(entry: TimelineEntry): TestArtifact[] {
  const artifacts = [
    ...(entry.artifact ? [entry.artifact] : []),
    ...(entry.artifacts ?? []),
  ].filter((artifact) => artifact.kind === 'screenshot')
  const before = entry.action?.evidence?.screenshots.before
  const after = entry.action?.evidence?.screenshots.after
  if (before?.state === 'available') artifacts.push(before.artifact)
  if (after?.state === 'available') artifacts.push(after.artifact)
  return [
    ...new Map(artifacts.map((artifact) => [artifact.path, artifact])).values(),
  ]
}

function frameCandidates(entries: readonly TimelineEntry[]) {
  return entries.flatMap((entry) =>
    screenshotsFor(entry).map((artifact) => ({
      artifact,
      entryId: entry.id,
      occurredAt: artifact.capturedAt ?? entry.startedAt,
    })),
  )
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function nearestFrame(
  candidates: readonly BrowserFrameCandidate[],
  selectedAt: string,
): BrowserFrameCandidate | undefined {
  const selectedTime = timestamp(selectedAt)
  return candidates.toSorted((left, right) => {
    const distance =
      Math.abs(timestamp(left.occurredAt) - selectedTime) -
      Math.abs(timestamp(right.occurredAt) - selectedTime)
    return distance || timestamp(left.occurredAt) - timestamp(right.occurredAt)
  })[0]
}

export function workbenchBrowserFrame(
  entries: readonly TimelineEntry[],
  selectedEntry: TimelineEntry,
): WorkbenchBrowserFrame | undefined {
  const candidates = frameCandidates(entries)
  const selectedAt = selectedEntry.finishedAt ?? selectedEntry.startedAt
  const ownFrame = nearestFrame(
    candidates.filter((candidate) => candidate.entryId === selectedEntry.id),
    selectedAt,
  )
  if (ownFrame) return { artifact: ownFrame.artifact, exact: true }
  const nearest = nearestFrame(candidates, selectedAt)
  return nearest ? { artifact: nearest.artifact, exact: false } : undefined
}
