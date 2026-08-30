import type {
  PersistedTestRun,
  RunEvent,
  TestRunStore,
} from '@pickle-spec/runner'
import {
  openTestRunStore,
  scheduleScenarios,
  validateTargetSelection,
} from '@pickle-spec/runner'
import { resolveApplicationRevision } from '../configuration/application-revision'
import type { ApplicationDiagnosticBuffer } from './application-diagnostics'
import { resolveEvidencePersistence } from './evidence-persistence'
import {
  type ManagedProjectServer,
  startApplicationDiagnostics,
} from './project-run/diagnostics'
import { executePreparedRun } from './project-run/execution'
import {
  type PreparedRunSelection,
  prepareRunSelection,
  selectedTargetFilter,
} from './project-run/selection'
import {
  disposeProjectRunTargets,
  type ResolvedProjectRunConfiguration,
  resolveProjectRunConfiguration,
} from './project-run/targets'
import type {
  ProjectRunOptions,
  ProjectRunResult,
  StartedProjectRun,
  StartProjectRunInput,
} from './project-run/types'

export {
  loadExtensions,
  loadPersistedRun,
  loadProjectSpecifications,
} from './project-run/inputs'
export { scenarioSelectionId } from './project-run/selection'
export type {
  ProjectLiveViewportUpdate,
  ProjectRunOptions,
  StartedProjectRun,
} from './project-run/types'

type ProjectRunStore = ReturnType<typeof openTestRunStore>
type PersistedProjectRun = Awaited<ReturnType<ProjectRunStore['create']>>

async function publishRunSchedule(
  input: StartProjectRunInput,
  selection: PreparedRunSelection,
  configuration: ResolvedProjectRunConfiguration,
): Promise<void> {
  await input.onSchedule?.(
    scheduleScenarios({
      selections: selection.selections,
      executionTargetProfiles: configuration.targets.map(
        ({ executionTargetProfile }) => executionTargetProfile,
      ),
      includeTarget: selectedTargetFilter(selection.selectedResults),
    }),
  )
}

function createPersistedEventHandler(
  input: StartProjectRunInput,
  testRun: PersistedProjectRun,
  diagnostics: ApplicationDiagnosticBuffer,
): (event: RunEvent) => Promise<void> {
  return async (event) => {
    const projected = diagnostics.project(event)
    const persisted = await testRun.append(projected)
    if (projected.type === 'scenario-finished') {
      await testRun.materialize({ finished: false })
    }
    await input.onEvent?.(persisted)
  }
}

async function replayPersistedEvents(
  input: StartProjectRunInput,
  testRun: PersistedProjectRun,
): Promise<void> {
  for (const event of await testRun.events()) await input.onEvent?.(event)
}

async function stopProjectResources(
  server: ManagedProjectServer,
  configuration: ResolvedProjectRunConfiguration | undefined,
): Promise<void> {
  if (server) {
    server.stop()
    await Promise.race([
      server.outputComplete.catch(() => undefined),
      Bun.sleep(1_000),
    ])
  }
  if (configuration) await disposeProjectRunTargets(configuration.targets)
}

interface ProjectRunWorkInput {
  applicationRevision: string | undefined
  args: ProjectRunOptions
  input: StartProjectRunInput
  root: string
  store: TestRunStore
  testRun: PersistedTestRun
}

async function runProjectWork(context: ProjectRunWorkInput) {
  const { applicationRevision, args, input, root, store, testRun } = context
  let configuration: ResolvedProjectRunConfiguration | undefined
  let server: ManagedProjectServer
  try {
    const selection = await prepareRunSelection(store, root, input.config, args)
    configuration = await resolveProjectRunConfiguration({
      config: input.config,
      args,
      applicationRevision,
      profileIds: selection.profileIds,
      root,
      onLiveViewport: input.onLiveViewport,
    })
    validateTargetSelection(selection.selections, configuration.targets)
    await publishRunSchedule(input, selection, configuration)
    const application = await startApplicationDiagnostics(
      input,
      args,
      configuration.targets,
    )
    server = application.server
    const onEvent = createPersistedEventHandler(
      input,
      testRun,
      application.diagnostics,
    )
    await replayPersistedEvents(input, testRun)
    const runs = await executePreparedRun({
      input,
      args,
      selection,
      configuration,
      testRun,
      root,
      onEvent,
    })
    return { runs, manifest: await testRun.materialize() }
  } finally {
    await stopProjectResources(server, configuration)
  }
}

export async function startProjectRun(
  input: StartProjectRunInput,
): Promise<StartedProjectRun> {
  const args = input.options ?? {}
  if (args.refreshCache && args.cacheOnly) {
    throw new Error('--refresh-cache cannot be combined with --cache-only')
  }
  const root = input.root
  const applicationRevision = resolveApplicationRevision(
    args.applicationRevision ?? input.config.applicationRevision,
    root,
  )
  const evidencePersistence = resolveEvidencePersistence({
    argument: args.evidencePersistence,
    configured: input.config.evidence?.persistence,
    artifactsCapture: input.config.artifacts?.capture,
  })
  const store = openTestRunStore({
    root,
    evidencePersistence,
    evidencePersistenceByProfile: Object.fromEntries(
      Object.entries(input.config.executionTargetProfiles ?? {}).flatMap(
        ([profileId, profile]) =>
          profile.evidence?.persistence
            ? [[profileId, profile.evidence.persistence]]
            : [],
      ),
    ),
  })
  const testRun = await store.create({
    sourceRunId: args.rerunId,
    suite: args.suite,
    applicationRevision,
    evidencePersistence,
  })

  const runWork = () =>
    runProjectWork({ applicationRevision, args, input, root, store, testRun })
  const done = new Promise<ProjectRunResult>((finish, reject) => {
    setTimeout(() => {
      void runWork().then(finish, reject)
    }, 0)
  })

  return { id: testRun.id, done }
}
