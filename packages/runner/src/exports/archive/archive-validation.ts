import { requiredValue } from '../../required-value'
import { recordableTestResult } from '../../results/public-results'
import { validateTestRunId } from '../../results/test-run-id'
import {
  aggregateTestResultState,
  materializeTestResults,
  type TestRunManifest,
} from '../../results/test-run-store'
import type { RunArchive } from '../archive'

export function assertConsistentRunArchive(archive: RunArchive): void {
  assertFinalizedManifest(archive.manifest)
  const startedEvents = archive.events.filter(
    (event) => event.type === 'run-started',
  )
  if (startedEvents.length !== 1) {
    throw new Error('Run archive requires exactly one run-started event')
  }
  const started = requiredValue(startedEvents[0])
  if (
    started.run.id !== archive.manifest.id ||
    started.run.startedAt !== archive.manifest.startedAt ||
    started.run.sourceRunId !== archive.manifest.sourceRunId ||
    started.run.suite !== archive.manifest.suite ||
    started.run.applicationRevision !== archive.manifest.applicationRevision
  ) {
    throw new Error('Run archive manifest must match its run-started event')
  }

  const eventResults = materializeTestResults(archive.events).map(
    recordableTestResult,
  )
  const manifestResults = archive.manifest.results.map(recordableTestResult)
  if (JSON.stringify(eventResults) !== JSON.stringify(manifestResults)) {
    throw new Error('Run archive manifest results must match its Run events')
  }
  if (
    manifestResults.length > 0 &&
    archive.manifest.state !== aggregateTestResultState(manifestResults)
  ) {
    throw new Error('Run archive manifest state must match its Test results')
  }
}

export function assertFinalizedManifest(manifest: TestRunManifest): void {
  if (!manifest.finishedAt) {
    throw new Error(
      `Test run "${manifest.id}" must be finalized before it can be archived`,
    )
  }
}

export { validateTestRunId as validateRunId }
