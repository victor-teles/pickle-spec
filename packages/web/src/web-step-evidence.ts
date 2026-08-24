import type {
  DiagnosticEntry,
  StepExecution,
  TraceEntry,
} from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import type { CollectedWebEvidence } from './web-evidence'

type ProjectWebStepEvidenceInput = {
  execution: StepExecution
  step: ScenarioStep
  collected: CollectedWebEvidence
  previousResolvedActionTrace: TraceEntry[]
}

type ProjectedWebStepEvidence = {
  execution: StepExecution
  nextResolvedActionTrace: TraceEntry[]
}

export function projectWebStepEvidence(
  input: ProjectWebStepEvidenceInput,
  now = () => new Date().toISOString(),
): ProjectedWebStepEvidence {
  const occurredAt =
    input.collected.diagnostics.at(-1)?.occurredAt ??
    input.collected.activity.at(-1)?.occurredAt ??
    now()
  const adapterDiagnostics: DiagnosticEntry[] = input.execution.message
    ? [
        {
          occurredAt,
          level:
            input.execution.state === 'infrastructure-error'
              ? 'error'
              : 'warning',
          origin: 'adapter',
          message: input.execution.message,
        },
      ]
    : []
  const diagnostics = [
    ...(input.execution.diagnostics ?? []),
    ...input.collected.diagnostics,
    ...adapterDiagnostics,
  ].map((entry) => ({ ...entry, causalAt: occurredAt }))
  const resolvedActionTrace: TraceEntry[] = input.execution.resolvedActions.map(
    (action) => ({
      occurredAt,
      causalAt: occurredAt,
      kind: 'resolved-action',
      description: action.description,
    }),
  )
  const causalActionTrace =
    input.step.type === 'outcome'
      ? input.previousResolvedActionTrace.map((entry) => ({
          ...entry,
          causalAt: occurredAt,
        }))
      : []
  const trace: TraceEntry[] = [
    ...(input.execution.trace ?? []),
    ...causalActionTrace,
    ...resolvedActionTrace,
    ...input.collected.activity.map((activity) => ({
      ...activity,
      causalAt: occurredAt,
      kind: 'browser-activity' as const,
    })),
  ]
  return {
    execution: {
      ...input.execution,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
      trace: trace.length > 0 ? trace : undefined,
      evidenceAvailability: [
        ...(input.execution.evidenceAvailability ?? []),
        ...(diagnostics.length > 0
          ? [{ kind: 'diagnostics' as const, state: 'available' as const }]
          : []),
        ...(trace.length > 0
          ? [{ kind: 'trace' as const, state: 'available' as const }]
          : []),
      ],
    },
    nextResolvedActionTrace:
      input.step.type === 'outcome' ? [] : resolvedActionTrace,
  }
}
