import { z } from 'zod'
import type { RunArchive, RunArchiveArtifact } from './archive'
import type {
  FidelityPolicy,
  RunEvent,
  TestResult,
  TestStepResult,
} from './run-scenario'
import type { TestRunManifest } from './test-run-store'

function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new Error(result.error.issues[0]?.message ?? 'Invalid run archive')
}

function object<Shape extends z.ZodRawShape>(field: string, shape: Shape) {
  return z.object(shape, { error: `${field} must be an object` })
}

const archiveStepInput = object('archive step', {
  step: z.unknown().optional(),
  state: z.unknown().optional(),
  resolvedActions: z.unknown().optional(),
  message: z.unknown().optional(),
  artifacts: z.unknown().optional(),
})

const archiveScenarioInput = object('archive result.scenario', {
  name: z.unknown().optional(),
  id: z.unknown().optional(),
})

const archiveResultInput = object('archive result', {
  specification: z.unknown().optional(),
  scenario: z.unknown().optional(),
  executionTargetProfile: z.unknown().optional(),
  state: z.unknown().optional(),
  steps: z.unknown().optional(),
  executionMode: z.unknown().optional(),
  cacheOutcome: z.unknown().optional(),
  inferenceCount: z.unknown().optional(),
  cacheUncacheableReason: z.unknown().optional(),
  failureKind: z.unknown().optional(),
  message: z.unknown().optional(),
  attempts: z.unknown().optional(),
  flaky: z.unknown().optional(),
  durationMs: z.unknown().optional(),
  fidelityPolicy: z.unknown().optional(),
})

const archiveManifestInput = object('archive manifest', {
  id: z.unknown().optional(),
  startedAt: z.unknown().optional(),
  finishedAt: z.unknown().optional(),
  sourceRunId: z.unknown().optional(),
  suite: z.unknown().optional(),
  applicationRevision: z.unknown().optional(),
  state: z.unknown().optional(),
  results: z.unknown().optional(),
})

const runArchiveInput = object('run archive', {
  manifest: z.unknown().optional(),
  events: z.unknown().optional(),
  artifacts: z.unknown().optional(),
})

const archiveEventInput = z.record(z.string(), z.unknown(), {
  error: 'archive event must be an object',
})

function migrateFidelityPolicy(value: unknown): FidelityPolicy | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const profile = 'profile' in value ? value.profile : undefined
  const tradeOffs = 'tradeOffs' in value ? value.tradeOffs : undefined
  return {
    profile: profile === 'fast' ? 'fast' : 'default',
    tradeOffs: Array.isArray(tradeOffs) ? tradeOffs.map(String) : [],
  }
}

function migrateStep(step: unknown): TestStepResult {
  const value = parsed(archiveStepInput, step)
  return {
    step: value.step as TestStepResult['step'],
    state: value.state as TestStepResult['state'],
    resolvedActions: Array.isArray(value.resolvedActions)
      ? value.resolvedActions.map(migrateResolvedAction)
      : [],
    message: typeof value.message === 'string' ? value.message : undefined,
    artifacts: Array.isArray(value.artifacts)
      ? (value.artifacts as TestStepResult['artifacts'])
      : undefined,
  }
}

function migrateResolvedAction(
  action: unknown,
): TestStepResult['resolvedActions'][number] {
  if (action === null || typeof action !== 'object') {
    return { description: String(action ?? '') }
  }
  const description = 'description' in action ? action.description : ''
  return { description: String(description ?? '') }
}

function migrateResult(result: unknown): TestResult {
  const value = parsed(archiveResultInput, result)
  const scenario = parsed(archiveScenarioInput, value.scenario)
  return {
    schemaVersion: 1,
    specification: value.specification as TestResult['specification'],
    scenario: {
      name: String(scenario.name ?? ''),
      id: typeof scenario.id === 'string' ? scenario.id : undefined,
    },
    executionTargetProfile:
      value.executionTargetProfile as TestResult['executionTargetProfile'],
    state: value.state as TestResult['state'],
    steps: Array.isArray(value.steps) ? value.steps.map(migrateStep) : [],
    executionMode:
      typeof value.executionMode === 'string'
        ? (value.executionMode as TestResult['executionMode'])
        : undefined,
    cacheOutcome:
      typeof value.cacheOutcome === 'string'
        ? (value.cacheOutcome as TestResult['cacheOutcome'])
        : undefined,
    inferenceCount:
      typeof value.inferenceCount === 'number'
        ? value.inferenceCount
        : undefined,
    cacheUncacheableReason:
      typeof value.cacheUncacheableReason === 'string'
        ? (value.cacheUncacheableReason as TestResult['cacheUncacheableReason'])
        : undefined,
    failureKind: value.failureKind === 'cache-miss' ? 'cache-miss' : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
    attempts: typeof value.attempts === 'number' ? value.attempts : undefined,
    flaky: typeof value.flaky === 'boolean' ? value.flaky : undefined,
    durationMs:
      typeof value.durationMs === 'number' ? value.durationMs : undefined,
    fidelityPolicy: migrateFidelityPolicy(value.fidelityPolicy),
  }
}

function migrateEvent(event: unknown, index: number): RunEvent {
  const value = parsed(archiveEventInput, event)
  const base = {
    schemaVersion: 1 as const,
    sequence: typeof value.sequence === 'number' ? value.sequence : index + 1,
  }
  if (value.type === 'scenario-finished') {
    return {
      ...base,
      type: 'scenario-finished',
      result: migrateResult(value.result),
    }
  }
  if (value.type === 'step-finished') {
    return {
      ...base,
      type: 'step-finished',
      result: migrateStep(value.result),
    }
  }
  return { ...base, ...value } as RunEvent
}

function migrateManifest(manifest: unknown): TestRunManifest {
  const value = parsed(archiveManifestInput, manifest)
  return {
    schemaVersion: 1,
    id: String(value.id ?? ''),
    startedAt: String(value.startedAt ?? ''),
    finishedAt:
      typeof value.finishedAt === 'string' ? value.finishedAt : undefined,
    sourceRunId:
      typeof value.sourceRunId === 'string' ? value.sourceRunId : undefined,
    suite: typeof value.suite === 'string' ? value.suite : undefined,
    applicationRevision:
      typeof value.applicationRevision === 'string'
        ? value.applicationRevision
        : undefined,
    state: value.state as TestRunManifest['state'],
    results: Array.isArray(value.results)
      ? value.results.map(migrateResult)
      : [],
  }
}

export function migrateRunArchive(value: unknown): RunArchive {
  const archive = parsed(runArchiveInput, value)
  const events = Array.isArray(archive.events) ? archive.events : []
  return {
    schemaVersion: 1,
    kind: 'run-archive',
    manifest: migrateManifest(archive.manifest),
    events: events.map(migrateEvent),
    artifacts: Array.isArray(archive.artifacts)
      ? (archive.artifacts as RunArchiveArtifact[])
      : [],
  }
}
