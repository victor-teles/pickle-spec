import type {
  ScheduledTestResult,
  TestResult,
  TestResultState,
} from '@pickle-spec/runner'
import type { StudioSpecification } from '../../server/contracts'
import { focusedAttemptProjection } from '../runs/result/focused-attempt'
import {
  displayedAttemptState,
  type LiveResultInspection,
  liveViewportFor,
} from '../runs/result/live-result-inspection'
import { locationFromResult } from '../runs/result/live-result-projection'
import type { ResultInspectionLocation } from '../runs/result/result-inspection'

export type WorkbenchTargetIdentity = {
  specificationUri: string
  scenarioId: string
  examplesRowId?: string
  profileId: string
}

type WorkbenchTargetBase = {
  adapter?: string
  identity: WorkbenchTargetIdentity
  key: string
  profileId: string
  scenarioName: string
  scheduleIndex: number
  specificationName: string
}

export type WorkbenchTarget =
  | (WorkbenchTargetBase & { kind: 'queued' })
  | (WorkbenchTargetBase & {
      durationMs: number
      kind: 'running'
      location: ResultInspectionLocation
    })
  | (WorkbenchTargetBase & {
      durationMs: number
      kind: 'completed'
      location: ResultInspectionLocation
      state: TestResultState
    })

export type WorkbenchTotals = {
  cancelled: number
  failed: number
  infrastructureError: number
  passed: number
  queued: number
  running: number
  scheduled: number
  skipped: number
}

type BrowseWorkbenchModel = {
  kind: 'browse'
  specifications: readonly StudioSpecification[]
}

export type BatchWorkbenchModel = {
  kind: 'batch'
  completed: readonly Extract<WorkbenchTarget, { kind: 'completed' }>[]
  connection: LiveResultInspection['connection']
  environmentLabel: string
  focus?: ReturnType<typeof focusedAttemptProjection>
  followedEntryId?: string
  following: boolean
  location?: ResultInspectionLocation
  phase: LiveResultInspection['phase']
  queued: readonly Extract<WorkbenchTarget, { kind: 'queued' }>[]
  runId: string
  running: readonly Extract<WorkbenchTarget, { kind: 'running' }>[]
  specifications: readonly StudioSpecification[]
  startedAt?: string
  totals: WorkbenchTotals
  viewport?: ReturnType<typeof liveViewportFor>
}

export type SpecificationsWorkbenchModel =
  | BrowseWorkbenchModel
  | BatchWorkbenchModel

function scenarioId(target: ScheduledTestResult): string {
  return target.scenario.id ?? target.scenario.name
}

function targetIdentity(target: ScheduledTestResult): WorkbenchTargetIdentity {
  return {
    specificationUri: target.specification.uri,
    scenarioId: scenarioId(target),
    examplesRowId: target.scenario.examplesRowId,
    profileId: target.executionTargetProfile.id,
  }
}

function identityKey(identity: WorkbenchTargetIdentity): string {
  return [
    identity.specificationUri,
    identity.scenarioId,
    identity.examplesRowId ?? '',
    identity.profileId,
  ].join('\u0000')
}

function resultIdentity(result: TestResult): WorkbenchTargetIdentity {
  return {
    specificationUri: result.specification.uri,
    scenarioId: result.scenario.id ?? result.scenario.name,
    examplesRowId: result.scenario.examplesRowId,
    profileId: result.executionTargetProfile.id,
  }
}

function baseTarget(
  target: ScheduledTestResult,
  scheduleIndex: number,
): WorkbenchTargetBase {
  const identity = targetIdentity(target)
  return {
    adapter: target.executionTargetProfile.adapter,
    identity,
    key: identityKey(identity),
    profileId: target.executionTargetProfile.id,
    scenarioName: target.scenario.name,
    scheduleIndex,
    specificationName: target.specification.name,
  }
}

function workbenchTarget(
  inspection: LiveResultInspection,
  results: ReadonlyMap<string, TestResult>,
  target: ScheduledTestResult,
  scheduleIndex: number,
): WorkbenchTarget {
  const base = baseTarget(target, scheduleIndex)
  const result = results.get(base.key)
  const attempt = result?.attempts.at(-1)
  if (!result || !attempt) return { ...base, kind: 'queued' }
  const location = locationFromResult(
    target.specification.uri,
    inspection.runId,
    result,
    attempt,
  )
  const state = displayedAttemptState(attempt)
  return state === 'running'
    ? { ...base, durationMs: attempt.durationMs, kind: 'running', location }
    : {
        ...base,
        durationMs: attempt.durationMs,
        kind: 'completed',
        location,
        state,
      }
}

function emptyTotals(scheduled: number): WorkbenchTotals {
  return {
    cancelled: 0,
    failed: 0,
    infrastructureError: 0,
    passed: 0,
    queued: 0,
    running: 0,
    scheduled,
    skipped: 0,
  }
}

function totalsFor(targets: readonly WorkbenchTarget[]): WorkbenchTotals {
  const totals = emptyTotals(targets.length)
  for (const target of targets) {
    if (target.kind === 'queued') totals.queued += 1
    else if (target.kind === 'running') totals.running += 1
    else if (target.state === 'infrastructure-error') {
      totals.infrastructureError += 1
    } else totals[target.state] += 1
  }
  return totals
}

function environmentLabel(schedule: readonly ScheduledTestResult[]): string {
  const adapters = new Set(
    schedule.flatMap((target) =>
      target.executionTargetProfile.adapter
        ? [target.executionTargetProfile.adapter]
        : [],
    ),
  )
  if (adapters.size === 1) return [...adapters][0] ?? 'Not recorded'
  if (adapters.size > 1) return 'Mixed'
  return 'Not recorded'
}

export function specificationsWorkbenchModel(input: {
  live?: LiveResultInspection
  specifications: readonly StudioSpecification[]
}): SpecificationsWorkbenchModel {
  const { live, specifications } = input
  if (!live) {
    return { kind: 'browse', specifications }
  }

  const results = new Map(
    (live.snapshot?.manifest?.results ?? []).map((result) => [
      identityKey(resultIdentity(result)),
      result,
    ]),
  )
  const targets = live.schedule.map((target, scheduleIndex) =>
    workbenchTarget(live, results, target, scheduleIndex),
  )
  const focus =
    live.snapshot && live.location
      ? focusedAttemptProjection(live.snapshot, live.location)
      : undefined

  return {
    kind: 'batch',
    completed: targets.filter(
      (target): target is Extract<WorkbenchTarget, { kind: 'completed' }> =>
        target.kind === 'completed',
    ),
    connection: live.connection,
    environmentLabel: environmentLabel(live.schedule),
    focus,
    followedEntryId: live.followedEntryId,
    following: live.following,
    location: live.location,
    phase: live.phase,
    queued: targets.filter(
      (target): target is Extract<WorkbenchTarget, { kind: 'queued' }> =>
        target.kind === 'queued',
    ),
    runId: live.runId,
    running: targets.filter(
      (target): target is Extract<WorkbenchTarget, { kind: 'running' }> =>
        target.kind === 'running',
    ),
    specifications,
    startedAt: live.snapshot?.manifest?.startedAt,
    totals: totalsFor(targets),
    viewport: live.location ? liveViewportFor(live, live.location) : undefined,
  }
}
