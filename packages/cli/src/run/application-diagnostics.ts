import type {
  DiagnosticEntry,
  EvidenceAvailability,
  RunEvent,
  ScenarioIdentity,
} from '@pickle-spec/runner'
import { requiredValue } from '../required-value'
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

class ApplicationDiagnosticBufferState {
  private readonly stdoutProfiles: ReadonlySet<string>
  private readonly stderrProfiles: ReadonlySet<string>
  private readonly active = new Map<string, ActiveScenario>()
  private readonly pending = new Map<string, ApplicationOutputLine[]>()

  constructor(private readonly options: ApplicationDiagnosticBufferOptions) {
    this.stdoutProfiles = requestedProfiles(options, 'stdout')
    this.stderrProfiles = requestedProfiles(options, 'stderr')
  }

  buffer(): ApplicationDiagnosticBuffer {
    return {
      record: (line) => this.record(line),
      project: (event) => this.project(event),
    }
  }

  private diagnosticFor(
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

  private appendDiagnostic(
    scenario: ActiveScenario,
    line: ApplicationOutputLine,
    scoped = true,
  ): DiagnosticEntry {
    const diagnostic = this.diagnosticFor(scenario, line, scoped)
    scenario.diagnostics.push(diagnostic)
    return diagnostic
  }

  private unscopedDiagnostic(
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

  private recordForProfile(
    profileId: string,
    line: ApplicationOutputLine,
  ): void {
    const scenarios = [...this.active.values()].filter(
      (scenario) => scenario.scope.executionTargetProfileId === profileId,
    )
    if (scenarios.length === 1) {
      const scenario = requiredValue(scenarios[0])
      const diagnostic = this.appendDiagnostic(scenario, line)
      this.options.onDiagnostic?.({
        profileId,
        scope: scenario.scope,
        diagnostic,
      })
      return
    }
    this.pending.set(profileId, [...(this.pending.get(profileId) ?? []), line])
    this.options.onDiagnostic?.({
      profileId,
      diagnostic: this.unscopedDiagnostic(profileId, line),
    })
  }

  private record(line: ApplicationOutputLine): void {
    const profiles =
      line.stream === 'stdout' ? this.stdoutProfiles : this.stderrProfiles
    for (const profileId of profiles) this.recordForProfile(profileId, line)
  }

  private startScenario(
    event: Extract<RunEvent, { type: 'scenario-started' }>,
  ): RunEvent {
    this.active.set(scopeKey(event.scope), {
      scenario: event.scenario,
      scope: event.scope,
      diagnostics: [],
      stepDiagnostics: new Map(),
    })
    return event
  }

  private finishStep(
    event: Extract<RunEvent, { type: 'step-finished' }>,
    scenario: ActiveScenario,
  ): RunEvent {
    const activeScenario = scenario
    const stepIndex = event.scope.stepIndex ?? event.result.index
    const diagnostics = activeScenario.diagnostics.filter(
      (entry) => entry.stepIndex === stepIndex,
    )
    activeScenario.diagnostics = activeScenario.diagnostics.filter(
      (entry) => entry.stepIndex !== stepIndex,
    )
    if (diagnostics.length > 0) {
      activeScenario.stepDiagnostics.set(stepIndex, diagnostics)
    }
    activeScenario.step = undefined
    if (diagnostics.length === 0) return event
    return {
      ...event,
      result: {
        ...event.result,
        diagnostics: [...(event.result.diagnostics ?? []), ...diagnostics],
      },
    }
  }

  private claimPendingOutput(
    event: Extract<RunEvent, { type: 'scenario-finished' }>,
    scenario: ActiveScenario,
  ): void {
    const profileId = event.scope.executionTargetProfileId
    const hasOtherActiveScenario = [...this.active.values()].some(
      (candidate) =>
        candidate !== scenario &&
        candidate.scope.executionTargetProfileId === profileId,
    )
    const ownsSharedOutput =
      event.attempt.state === 'failed' ||
      event.attempt.state === 'infrastructure-error' ||
      !hasOtherActiveScenario
    if (!ownsSharedOutput) return
    for (const line of this.pending.get(profileId) ?? []) {
      this.appendDiagnostic(scenario, line, false)
    }
    this.pending.delete(profileId)
  }

  private finishScenario(
    event: Extract<RunEvent, { type: 'scenario-finished' }>,
    scenario: ActiveScenario,
  ): RunEvent {
    this.claimPendingOutput(event, scenario)
    this.active.delete(scopeKey(event.scope))
    const steps = event.attempt.steps.map((step) => {
      const diagnostics = scenario.stepDiagnostics.get(step.index) ?? []
      return diagnostics.length === 0
        ? step
        : {
            ...step,
            diagnostics: [...(step.diagnostics ?? []), ...diagnostics],
          }
    })
    const diagnostics = [
      ...(event.attempt.diagnostics ?? []),
      ...scenario.diagnostics,
    ]
    const stepDiagnostics = steps.flatMap((step) => step.diagnostics ?? [])
    return {
      ...event,
      attempt: {
        ...event.attempt,
        steps,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        evidenceAvailability: availabilityFor(
          event.attempt.evidenceAvailability,
          this.options,
          event.scope.executionTargetProfileId,
          diagnostics.length > 0 || stepDiagnostics.length > 0,
        ),
        applicationOutputAvailability: applicationOutputAvailabilityFor(
          this.options,
          event.scope.executionTargetProfileId,
          [...diagnostics, ...stepDiagnostics],
        ),
      },
    }
  }

  private startStep(
    event: Extract<RunEvent, { type: 'step-started' }>,
  ): RunEvent {
    const scenario = this.active.get(scopeKey(event.scope))
    if (!scenario) return event
    scenario.step = {
      index: event.scope.stepIndex ?? 0,
      text: `${event.step.keyword.trim()} ${event.step.text}`,
    }
    return event
  }

  private finishActiveStep(
    event: Extract<RunEvent, { type: 'step-finished' }>,
  ): RunEvent {
    const scenario = this.active.get(scopeKey(event.scope))
    return scenario ? this.finishStep(event, scenario) : event
  }

  private finishActiveScenario(
    event: Extract<RunEvent, { type: 'scenario-finished' }>,
  ): RunEvent {
    const scenario = this.active.get(scopeKey(event.scope))
    return scenario ? this.finishScenario(event, scenario) : event
  }

  private projectActiveEvent(event: RunEvent): RunEvent {
    if (event.type === 'step-started') return this.startStep(event)
    if (event.type === 'step-finished') return this.finishActiveStep(event)
    if (event.type === 'scenario-finished') {
      return this.finishActiveScenario(event)
    }
    return event
  }

  private project(event: RunEvent): RunEvent {
    return event.type === 'scenario-started'
      ? this.startScenario(event)
      : this.projectActiveEvent(event)
  }
}

export function createApplicationDiagnosticBuffer(
  options: ApplicationDiagnosticBufferOptions,
): ApplicationDiagnosticBuffer {
  return new ApplicationDiagnosticBufferState(options).buffer()
}
