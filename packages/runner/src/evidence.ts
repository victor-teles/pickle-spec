import type {
  DiagnosticEntry,
  EvidenceKind,
  TestStepResult,
} from './run-scenario-types'

export function persistedEvidenceKinds(
  steps: readonly TestStepResult[],
  attemptDiagnostics: readonly DiagnosticEntry[] = [],
): Set<EvidenceKind> {
  const kinds = new Set<EvidenceKind>()
  for (const step of steps) {
    for (const artifact of step.artifacts ?? []) kinds.add(artifact.kind)
    if (step.diagnostics?.length) kinds.add('diagnostics')
    if (step.trace?.length) kinds.add('trace')
  }
  if (attemptDiagnostics.length > 0) kinds.add('diagnostics')
  return kinds
}
