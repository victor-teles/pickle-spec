import type {
  DiagnosticEntry,
  EvidenceAvailability,
  RunEvent,
  ScenarioIdentity,
} from '@pickle-spec/runner'
import type {
  ApplicationOutputAvailability,
  ApplicationOutputLine,
  ApplicationOutputStream,
} from '../server/server'

export interface ApplicationDiagnosticBufferOptions {
  profiles: Record<ApplicationOutputStream, readonly string[]>
  availability: ApplicationOutputAvailability
  onDiagnostic?: (event: LiveApplicationDiagnostic) => void
}

export interface LiveApplicationDiagnostic {
  profileId: string
  scope?: RunEventScope
  diagnostic: DiagnosticEntry
}

interface ActiveScenario {
  scenario: ScenarioIdentity
  scope: RunEventScope
  step?: { index: number; text: string }
  diagnostics: DiagnosticEntry[]
  stepDiagnostics: Map<number, DiagnosticEntry[]>
}

type RunEventScope = Extract<RunEvent, { type: 'scenario-started' }>['scope']

export interface ApplicationDiagnosticBuffer {
  record(line: ApplicationOutputLine): void
  project(event: RunEvent): RunEvent
}

function scopeKey(scope: RunEventScope): string {
  return [
    scope.scenarioId,
    scope.examplesRowId ?? '',
    scope.executionTargetProfileId,
    scope.attempt,
  ].join('\u0000')
}

function requestedProfiles(
  options: ApplicationDiagnosticBufferOptions,
  stream: ApplicationOutputStream,
): ReadonlySet<string> {
  return new Set(options.profiles[stream])
}

function availabilityFor(
  current: readonly EvidenceAvailability[],
  options: ApplicationDiagnosticBufferOptions,
  profileId: string,
  hasDiagnostics: boolean,
): EvidenceAvailability[] {
  const requested = (['stdout', 'stderr'] as const).filter((stream) =>
    options.profiles[stream].includes(profileId),
  )
  if (requested.length === 0) return [...current]
  const diagnostic = current.find((item) => item.kind === 'diagnostics')
  if (hasDiagnostics || diagnostic?.state === 'available') {
    return replaceDiagnosticsAvailability(current, {
      kind: 'diagnostics',
      state: 'available',
    })
  }
  const unsupported = requested.filter(
    (stream) => options.availability[stream] === 'not-supported',
  )
  if (unsupported.length > 0) {
    return replaceDiagnosticsAvailability(current, {
      kind: 'diagnostics',
      state: 'not-supported',
      message: `Managed application ${unsupported.join(' and ')} ${unsupported.length === 1 ? 'is' : 'are'} unavailable for a reused server.`,
    })
  }
  return replaceDiagnosticsAvailability(current, {
    kind: 'diagnostics',
    state: 'missing',
    message: `Managed application ${requested.join(' and ')} capture produced no lines.`,
  })
}

function applicationOutputAvailabilityFor(
  options: ApplicationDiagnosticBufferOptions,
  profileId: string,
  diagnostics: readonly DiagnosticEntry[],
) {
  return (['stdout', 'stderr'] as const).map((stream) => {
    if (!options.profiles[stream].includes(profileId)) {
      return { stream, state: 'not-requested' as const }
    }
    if (diagnostics.some((entry) => entry.stream === stream)) {
      return { stream, state: 'available' as const }
    }
    if (options.availability[stream] === 'not-supported') {
      return {
        stream,
        state: 'not-supported' as const,
        message: `Managed application ${stream} is unavailable for a reused server.`,
      }
    }
    return {
      stream,
      state: 'missing' as const,
      message: `Managed application ${stream} capture produced no lines.`,
    }
  })
}

function replaceDiagnosticsAvailability(
  current: readonly EvidenceAvailability[],
  replacement: EvidenceAvailability,
): EvidenceAvailability[] {
  return current.map((item) =>
    item.kind === 'diagnostics' ? replacement : item,
  )
}

export function createApplicationDiagnosticBuffer(
  options: ApplicationDiagnosticBufferOptions,
): ApplicationDiagnosticBuffer {
  const stdoutProfiles = requestedProfiles(options, 'stdout')
  const stderrProfiles = requestedProfiles(options, 'stderr')
  const active = new Map<string, ActiveScenario>()
  const pending = new Map<string, ApplicationOutputLine[]>()

  function diagnosticFor(
    scenario: ActiveScenario,
    line: ApplicationOutputLine,
    scoped: boolean,
  ): DiagnosticEntry {
    return {
      occurredAt: line.occurredAt,
      level: line.stream === 'stderr' ? 'warning' : 'info',
      origin: 'application',
      stream: line.stream,
      message: line.line,
      ...(scoped
        ? {
            scenarioId: scenario.scope.scenarioId,
            scenarioName: scenario.scenario.name,
            stepIndex: scenario.step?.index,
            stepText: scenario.step?.text,
          }
        : {}),
      executionTargetProfileId: scenario.scope.executionTargetProfileId,
    }
  }

  function appendDiagnostic(
    scenario: ActiveScenario,
    line: ApplicationOutputLine,
    scoped = true,
  ): DiagnosticEntry {
    const diagnostic = diagnosticFor(scenario, line, scoped)
    scenario.diagnostics.push(diagnostic)
    return diagnostic
  }

  function unscopedDiagnostic(
    profileId: string,
    line: ApplicationOutputLine,
  ): DiagnosticEntry {
    return {
      occurredAt: line.occurredAt,
      level: line.stream === 'stderr' ? 'warning' : 'info',
      origin: 'application',
      stream: line.stream,
      message: line.line,
      executionTargetProfileId: profileId,
    }
  }

  function record(line: ApplicationOutputLine): void {
    const profiles = line.stream === 'stdout' ? stdoutProfiles : stderrProfiles
    for (const profileId of profiles) {
      const scenarios = [...active.values()].filter(
        (scenario) => scenario.scope.executionTargetProfileId === profileId,
      )
      if (scenarios.length === 0) {
        pending.set(profileId, [...(pending.get(profileId) ?? []), line])
        options.onDiagnostic?.({
          profileId,
          diagnostic: unscopedDiagnostic(profileId, line),
        })
        continue
      }
      if (scenarios.length === 1) {
        const scenario = scenarios[0]!
        const diagnostic = appendDiagnostic(scenario, line)
        options.onDiagnostic?.({
          profileId,
          scope: scenario.scope,
          diagnostic,
        })
        continue
      }
      pending.set(profileId, [...(pending.get(profileId) ?? []), line])
      options.onDiagnostic?.({
        profileId,
        diagnostic: unscopedDiagnostic(profileId, line),
      })
    }
  }

  function project(event: RunEvent): RunEvent {
    if (event.type === 'scenario-started') {
      const scenario: ActiveScenario = {
        scenario: event.scenario,
        scope: event.scope,
        diagnostics: [],
        stepDiagnostics: new Map(),
      }
      active.set(scopeKey(event.scope), scenario)
      return event
    }

    const scenario = 'scope' in event ? active.get(scopeKey(event.scope)) : null
    if (event.type === 'step-started' && scenario) {
      scenario.step = {
        index: event.scope.stepIndex ?? 0,
        text: `${event.step.keyword.trim()} ${event.step.text}`,
      }
      return event
    }
    if (event.type === 'step-finished' && scenario) {
      const stepIndex = event.scope.stepIndex ?? event.result.index
      const diagnostics = scenario.diagnostics.filter(
        (entry) => entry.stepIndex === stepIndex,
      )
      scenario.diagnostics = scenario.diagnostics.filter(
        (entry) => entry.stepIndex !== stepIndex,
      )
      if (diagnostics.length > 0) {
        scenario.stepDiagnostics.set(stepIndex, diagnostics)
      }
      scenario.step = undefined
      if (diagnostics.length === 0) return event
      return {
        ...event,
        result: {
          ...event.result,
          diagnostics: [...(event.result.diagnostics ?? []), ...diagnostics],
        },
      }
    }
    if (event.type === 'scenario-finished' && scenario) {
      const profileId = event.scope.executionTargetProfileId
      const otherActiveScenarios = [...active.values()].filter(
        (candidate) =>
          candidate !== scenario &&
          candidate.scope.executionTargetProfileId === profileId,
      )
      const ownsSharedOutput =
        event.attempt.state === 'failed' ||
        event.attempt.state === 'infrastructure-error' ||
        otherActiveScenarios.length === 0
      if (ownsSharedOutput) {
        for (const line of pending.get(profileId) ?? []) {
          appendDiagnostic(scenario, line, false)
        }
        pending.delete(profileId)
      }
      active.delete(scopeKey(event.scope))
      const steps = event.attempt.steps.map((step) => {
        const diagnostics = scenario.stepDiagnostics.get(step.index) ?? []
        if (diagnostics.length === 0) return step
        return {
          ...step,
          diagnostics: [...(step.diagnostics ?? []), ...diagnostics],
        }
      })
      const diagnostics = [
        ...(event.attempt.diagnostics ?? []),
        ...scenario.diagnostics,
      ]
      const stepsHaveDiagnostics = steps.some(
        (step) => (step.diagnostics?.length ?? 0) > 0,
      )
      return {
        ...event,
        attempt: {
          ...event.attempt,
          steps,
          diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
          evidenceAvailability: availabilityFor(
            event.attempt.evidenceAvailability,
            options,
            event.scope.executionTargetProfileId,
            diagnostics.length > 0 || stepsHaveDiagnostics,
          ),
          applicationOutputAvailability: applicationOutputAvailabilityFor(
            options,
            event.scope.executionTargetProfileId,
            [
              ...diagnostics,
              ...steps.flatMap((step) => step.diagnostics ?? []),
            ],
          ),
        },
      }
    }
    return event
  }

  return { record, project }
}
