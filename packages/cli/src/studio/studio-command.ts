import type {
  StudioAuthoringModel,
  StudioLiveViewportEvent,
  StudioManagementGateway,
  StudioRunGateway,
} from '@pickle-spec/studio'
import { createCredentialStore, startStudio } from '@pickle-spec/studio'
import { defaultModelName } from '@pickle-spec/web'
import type { StudioCommandInput } from '../command-inputs'
import { defaultSpecificationGlob, loadConfig } from '../configuration/config'
import { diagnoseProjectEnvironment } from '../doctor/project-environment'
import {
  loadExtensions,
  loadPersistedRun,
  loadProjectSpecifications,
  type ProjectLiveViewportUpdate,
  startProjectRun,
} from '../run/execute-run'
import { errorMessage } from '../terminal/command-error'
import { createStudioExecutionCacheGateway } from './studio-cache'
import { createStudioHistoryGateway } from './studio-history'
import {
  discoverStudioMobileTargets,
  studioMobileEnvironmentAdapterFactory,
  validateStudioMobileTargetCapabilities,
} from './studio-mobile-targets'
import {
  loadStudioProject,
  patchStudioConfig,
  resolveConfigSecrets,
  saveStudioCredential,
  studioRunReadiness,
  studioRunReadinessWithEnvironment,
  studioRunSelection,
} from './studio-project'

const dayMs = 24 * 60 * 60 * 1000

function authoringModel(modelName: string | undefined): StudioAuthoringModel {
  const value = modelName ?? defaultModelName
  const separator = value.indexOf('/')
  if (separator <= 0) return { provider: value, name: value }
  return {
    provider: value.slice(0, separator),
    name: value.slice(separator + 1),
  }
}

interface StudioCommandContext {
  args: StudioCommandInput
  credentials: ReturnType<typeof createCredentialStore>
  extensions: Awaited<ReturnType<typeof loadExtensions>>
  project: Parameters<typeof loadStudioProject>[0]
  root: string
}

function studioManagementGateway(
  context: StudioCommandContext,
): StudioManagementGateway {
  const { args, extensions, project, root } = context
  return {
    saveConfig: (patch) => patchStudioConfig(project, patch),
    saveCredential: (input) => saveStudioCredential(project, input),
    async discoverMobileTargets() {
      const config = await loadConfig(args.configPath, root)
      return discoverStudioMobileTargets(config, undefined, extensions.adapters)
    },
    async readiness(request) {
      const config = await loadConfig(args.configPath, root)
      const specifications = await loadProjectSpecifications(
        config.specifications ?? defaultSpecificationGlob,
        config.language,
        root,
      )
      const readiness = await studioRunReadiness(
        project,
        request,
        config,
        specifications,
      )
      const environment = await diagnoseProjectEnvironment(config, {
        profileIds: request?.profiles,
        mobileAdapterFactory: (profileId) =>
          studioMobileEnvironmentAdapterFactory(extensions.adapters, profileId),
      })
      return studioRunReadinessWithEnvironment(readiness, environment)
    },
  }
}

async function waitForStudioStop(
  server: Awaited<ReturnType<typeof startStudio>>,
  controller: AbortController,
): Promise<void> {
  await new Promise<void>((finish) => {
    const stop = () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      controller.abort()
      server.stop()
      finish()
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })
}

interface StudioRunGatewayInput {
  activeRuns: Map<string, AbortController>
  context: StudioCommandContext
  controller: AbortController
}

function studioLiveViewportEvent(
  update: ProjectLiveViewportUpdate,
): StudioLiveViewportEvent {
  if (update.kind === 'closed') {
    return { type: 'viewport-closed', target: update.target }
  }
  const { target, ...viewport } = update
  return { type: 'viewport-updated', target, viewport }
}

function studioRunGateway(input: StudioRunGatewayInput): StudioRunGateway {
  const { activeRuns, context, controller } = input
  const { args, credentials, extensions, root } = context
  return {
    async start(request, onEvent) {
      const runController = new AbortController()
      const onProcessAbort = () => runController.abort()
      controller.signal.addEventListener('abort', onProcessAbort, {
        once: true,
      })
      const config = await loadConfig(args.configPath, root)
      validateStudioMobileTargetCapabilities(
        config,
        await discoverStudioMobileTargets(
          config,
          undefined,
          extensions.adapters,
          request?.profiles,
        ),
        request?.profiles,
      )
      const started = await startProjectRun({
        root,
        config: await resolveConfigSecrets(config, credentials),
        options: {
          extensionsPath: args.extensionsPath,
          suite: request?.suite,
          profiles: request?.profiles ? [...request.profiles] : undefined,
          selection: studioRunSelection(request),
          rerunId: request?.rerunId,
          scenarioIds: request?.scenarioId ? [request.scenarioId] : undefined,
          failures: request?.failures,
          refreshCache: request?.refreshCache,
        },
        signal: runController.signal,
        onEvent,
        onSchedule: (schedule) => onEvent({ type: 'run-scheduled', schedule }),
        onApplicationDiagnostic: (event) =>
          onEvent({ type: 'diagnostic-recorded', ...event }),
        onLiveViewport: (update) => onEvent(studioLiveViewportEvent(update)),
      })
      activeRuns.set(started.id, runController)
      void started.done
        .catch((error) => console.error(errorMessage(error)))
        .finally(() => {
          activeRuns.delete(started.id)
          controller.signal.removeEventListener('abort', onProcessAbort)
        })
      return { id: started.id, done: started.done }
    },
    async snapshot(id) {
      const { events, manifest } = await loadPersistedRun(root, id)
      return { id, events, manifest }
    },
    async cancel(id) {
      activeRuns.get(id)?.abort()
    },
  }
}

export async function runStudioCommand(
  args: StudioCommandInput,
): Promise<number> {
  const root = process.cwd()
  const credentials = createCredentialStore()
  const project = {
    root,
    configPath: args.configPath,
    credentials,
  }
  const config = await loadConfig(args.configPath, root)
  const specificationGlobs = config.specifications ?? defaultSpecificationGlob
  const model = authoringModel(config.web?.browser?.modelName)
  async function loadProject() {
    return loadStudioProject(project)
  }
  const extensions = await loadExtensions(args.extensionsPath, root)
  const controller = new AbortController()
  const activeRuns = new Map<string, AbortController>()
  const context: StudioCommandContext = {
    args,
    credentials,
    extensions,
    project,
    root,
  }
  const server = await startStudio({
    project: await loadProject(),
    loadProject,
    specificationGlobs,
    language: config.language,
    authoring: {
      model,
      propose: extensions.authorSpecification,
    },
    management: studioManagementGateway(context),
    executionCache: createStudioExecutionCacheGateway(root, async () => {
      const current = await loadConfig(args.configPath, root)
      return current.cache ?? {}
    }),
    history: createStudioHistoryGateway(root, async () => {
      const current = await loadConfig(args.configPath, root)
      return {
        maxAgeMs: current.retention?.days
          ? current.retention.days * dayMs
          : undefined,
        maxBytes: current.retention?.maxBytes,
      }
    }),
    gateway: studioRunGateway({ activeRuns, context, controller }),
    hostname: args.remoteHost,
    allowRemoteAccess: Boolean(args.remoteHost),
    open: args.open,
    port: args.port,
  })
  console.log(`Studio ${server.url}`)
  await waitForStudioStop(server, controller)
  return 0
}
