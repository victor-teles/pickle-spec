import {
  resolveScenarioId,
  type Scenario,
  type ScenarioStep,
  type ScenarioVariableBinding,
  type Specification,
} from '@pickle-spec/spec'
import { requiredValue } from '../required-value'
import type {
  ActionEvidence,
  ActionEvidenceInput,
  DiagnosticEntry,
  ScenarioIdentity,
  StepExecution,
  TestArtifact,
  TraceEntry,
} from './run-scenario'

const targetSummaryLimit = 2_000
const targetLocationLimit = 2_048
const sensitiveLocationParameter =
  /(?:token|key|secret|password|credential|session|auth)/i

export interface PublicStepExecution {
  execution: StepExecution
  runtimeValueExposed: boolean
}

export function scenarioIdentity(scenario: Scenario): ScenarioIdentity {
  return {
    name: scenario.template?.name ?? scenario.name,
    id: scenario.id,
    examplesId: scenario.examplesId,
    examplesRowId: scenario.examplesRowId,
  }
}

export function scenarioDefinitionId(
  specification: Specification,
  scenario: Scenario,
): string {
  return (
    scenario.id ??
    resolveScenarioId(
      specification.source.uri,
      specification.name,
      scenario.template?.name ?? scenario.name,
      scenario.tags,
    )
  )
}

export function templateStepAt(
  scenario: Scenario,
  stepIndex: number,
): ScenarioStep {
  return (
    scenario.template?.steps[stepIndex] ??
    requiredValue(scenario.steps[stepIndex])
  )
}

export function nonemptyBindings(
  bindings: readonly ScenarioVariableBinding[] | undefined,
): readonly ScenarioVariableBinding[] {
  return (bindings ?? []).filter((binding) => binding.value.length > 0)
}

export function stringContainsBinding(
  value: string,
  bindings: readonly ScenarioVariableBinding[],
): boolean {
  return bindings.some((binding) => value.includes(binding.value))
}

export function redactString(
  value: string,
  bindings: readonly ScenarioVariableBinding[],
): string {
  return [...bindings]
    .sort((left, right) => right.value.length - left.value.length)
    .reduce(
      (redacted, binding) =>
        redacted.replaceAll(binding.value, `<${binding.name}>`),
      value,
    )
}

function redactReplayValue(
  value: unknown,
  bindings: readonly ScenarioVariableBinding[],
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') return redactString(value, bindings)
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    return value.map((item) => redactReplayValue(item, bindings, seen))
  }
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      redactString(key, bindings),
      redactReplayValue(item, bindings, seen),
    ]),
  )
}

function valueContainsBinding(
  value: unknown,
  bindings: readonly ScenarioVariableBinding[],
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value === 'string') return stringContainsBinding(value, bindings)
  if (!value || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  return Object.entries(value).some(
    ([key, item]) =>
      stringContainsBinding(key, bindings) ||
      valueContainsBinding(item, bindings, seen),
  )
}

function publicArtifacts(
  artifacts: readonly TestArtifact[] | undefined,
  bindings: readonly ScenarioVariableBinding[],
): TestArtifact[] | undefined {
  return artifacts?.map((artifact) => ({
    ...artifact,
    path: redactString(artifact.path, bindings),
    mediaType: artifact.mediaType
      ? redactString(artifact.mediaType, bindings)
      : undefined,
    name: artifact.name ? redactString(artifact.name, bindings) : undefined,
  }))
}

function bounded(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

function publicLocation(
  value: string | undefined,
  bindings: readonly ScenarioVariableBinding[],
): string | undefined {
  if (!value) return undefined
  const redacted = redactString(value, bindings)
  try {
    const url = new URL(redacted)
    url.username = ''
    url.password = ''
    for (const name of url.searchParams.keys()) {
      if (sensitiveLocationParameter.test(name)) {
        url.searchParams.set(name, '<redacted>')
      }
    }
    return bounded(url.toString(), targetLocationLimit)
  } catch {
    return bounded(redacted, targetLocationLimit)
  }
}

function publicScreenshot(
  screenshot: ActionEvidence['screenshots']['before'],
  bindings: readonly ScenarioVariableBinding[],
): ActionEvidence['screenshots']['before'] {
  if (screenshot.state !== 'available') {
    return {
      ...screenshot,
      message: screenshot.message
        ? redactString(screenshot.message, bindings)
        : undefined,
    }
  }
  const artifact = publicArtifacts([screenshot.artifact], bindings)?.[0]
  return artifact
    ? { state: 'available', artifact }
    : { state: 'missing', message: 'Screenshot artifact is missing' }
}

export function publicActionEvidence(
  input: ActionEvidenceInput,
  identity: {
    id: string
    ordinal: number
    source: ActionEvidence['source']
  },
  bindings: readonly ScenarioVariableBinding[],
): ActionEvidence {
  return {
    version: 1,
    id: identity.id,
    ordinal: identity.ordinal,
    description: redactString(input.description, bindings),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: Math.max(
      0,
      Date.parse(input.finishedAt) - Date.parse(input.startedAt),
    ),
    state: input.state,
    message: input.message ? redactString(input.message, bindings) : undefined,
    source: {
      ...identity.source,
      excerpt: redactString(identity.source.excerpt, bindings),
    },
    target: {
      before: {
        format: 'summary',
        summary: bounded(
          redactString(input.target.before.summary, bindings),
          targetSummaryLimit,
        ),
        location: publicLocation(input.target.before.location, bindings),
      },
      after: {
        format: 'summary',
        summary: bounded(
          redactString(input.target.after.summary, bindings),
          targetSummaryLimit,
        ),
        location: publicLocation(input.target.after.location, bindings),
      },
    },
    screenshots: {
      before: publicScreenshot(input.screenshots.before, bindings),
      after: publicScreenshot(input.screenshots.after, bindings),
    },
    diagnostics: (input.diagnostics ?? []).map((diagnostic) =>
      publicDiagnostic(diagnostic, bindings),
    ),
    activity: (input.activity ?? []).map((entry) =>
      publicTrace(entry, bindings),
    ),
  }
}

export function publicStepExecution(
  execution: StepExecution,
  bindings: readonly ScenarioVariableBinding[],
): PublicStepExecution {
  const runtimeValueExposed = valueContainsBinding(
    {
      resolvedActions: execution.resolvedActions,
      message: execution.message,
      artifacts: execution.artifacts,
      evidenceAvailability: execution.evidenceAvailability,
      diagnostics: execution.diagnostics,
      trace: execution.trace,
    },
    bindings,
  )
  return {
    runtimeValueExposed,
    execution: {
      ...execution,
      resolvedActions: execution.resolvedActions.map((action) => ({
        description: redactString(action.description, bindings),
        evidence: action.evidence
          ? publicActionEvidence(
              action.evidence,
              {
                id: action.evidence.id,
                ordinal: action.evidence.ordinal,
                source: action.evidence.source,
              },
              bindings,
            )
          : undefined,
        replay: action.replay
          ? (redactReplayValue(action.replay, bindings) as Record<
              string,
              unknown
            >)
          : undefined,
      })),
      message: execution.message
        ? redactString(execution.message, bindings)
        : undefined,
      artifacts: publicArtifacts(execution.artifacts, bindings),
      diagnostics: execution.diagnostics?.map((diagnostic) =>
        publicDiagnostic(diagnostic, bindings),
      ),
      trace: execution.trace?.map((entry) => publicTrace(entry, bindings)),
      evidenceAvailability: execution.evidenceAvailability?.map(
        (availability) => ({
          ...availability,
          message: availability.message
            ? redactString(availability.message, bindings)
            : undefined,
        }),
      ),
    },
  }
}

function publicDiagnostic(
  diagnostic: DiagnosticEntry,
  bindings: readonly ScenarioVariableBinding[],
): DiagnosticEntry {
  return {
    ...diagnostic,
    message: redactString(diagnostic.message, bindings),
    scenarioId: diagnostic.scenarioId
      ? redactString(diagnostic.scenarioId, bindings)
      : undefined,
    scenarioName: diagnostic.scenarioName
      ? redactString(diagnostic.scenarioName, bindings)
      : undefined,
    stepText: diagnostic.stepText
      ? redactString(diagnostic.stepText, bindings)
      : undefined,
    executionTargetProfileId: diagnostic.executionTargetProfileId
      ? redactString(diagnostic.executionTargetProfileId, bindings)
      : undefined,
  }
}

function publicTrace(
  entry: TraceEntry,
  bindings: readonly ScenarioVariableBinding[],
): TraceEntry {
  return {
    ...entry,
    description: redactString(entry.description, bindings),
  }
}
