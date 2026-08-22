import {
  resolveScenarioId,
  type Scenario,
  type ScenarioStep,
  type ScenarioVariableBinding,
  type Specification,
} from '@pickle-spec/spec'
import type {
  ScenarioIdentity,
  StepExecution,
  TestArtifact,
} from './run-scenario'

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
  return scenario.template?.steps[stepIndex] ?? scenario.steps[stepIndex]!
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
  }))
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
    },
    bindings,
  )
  return {
    runtimeValueExposed,
    execution: {
      ...execution,
      resolvedActions: execution.resolvedActions.map((action) => ({
        description: redactString(action.description, bindings),
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
