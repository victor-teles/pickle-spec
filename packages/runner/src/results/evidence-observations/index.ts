import type {
  RunEvent,
  SharedEvidenceObservation,
} from '../../execution/run-scenario-types'
import {
  attemptDiagnosticObservations,
  attemptOutcomeObservation,
  cacheObservation,
  inferenceObservation,
  stepActivityObservations,
  stepArtifactObservations,
  stepDiagnosticObservations,
  stepOutcomeObservation,
} from './builders'

export function sharedEvidenceObservationsForEvent(
  event: RunEvent,
): SharedEvidenceObservation[] | undefined {
  switch (event.type) {
    case 'step-finished':
      return [
        stepOutcomeObservation(event),
        ...stepActivityObservations(event),
        ...stepDiagnosticObservations(event.result.diagnostics),
        ...stepArtifactObservations(event.result.artifacts, event),
      ]
    case 'scenario-finished':
      return [
        attemptOutcomeObservation(event),
        ...attemptDiagnosticObservations(event.attempt.diagnostics),
      ]
    case 'cache-hit':
    case 'cache-miss':
    case 'cache-refresh':
    case 'replay-diverged':
    case 'adaptive-fallback-started':
    case 'cache-written':
    case 'cache-uncacheable':
      return [cacheObservation(event)]
    case 'inference-count-updated':
      return [inferenceObservation(event)]
    default:
      return undefined
  }
}

export function withSharedEvidenceObservations(event: RunEvent): RunEvent {
  const observations = sharedEvidenceObservationsForEvent(event)
  if (!observations?.length) return event
  return {
    ...event,
    observations,
  }
}
