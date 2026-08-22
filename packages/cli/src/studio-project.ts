import { basename } from 'node:path'
import type { ExecutionTargetAdapter } from '@pickle-spec/runner'
import { validateTargetSelection } from '@pickle-spec/runner'
import {
  authorTags,
  parseExternalLinks,
  type SelectionOptions,
  type Specification,
  selectScenarios,
} from '@pickle-spec/spec'
import type {
  CredentialStore,
  StudioConfigPatch,
  StudioCredential,
  StudioProfile,
  StudioProject,
  StudioRunReadiness,
  StudioRunRequest,
  StudioSpecification,
  StudioSuite,
} from '@pickle-spec/studio'
import {
  defaultSpecificationGlob,
  loadConfig,
  type PickleConfig,
  type ProjectExecutionTargetProfile,
  runConfigurationFrom,
  saveConfig,
} from './config'
import { loadProjectSpecifications } from './execute-run'

export interface StudioProjectContext {
  root: string
  configPath?: string
  credentials: CredentialStore
}

export function studioRunSelection(
  request: StudioRunRequest | undefined,
): SelectionOptions | undefined {
  if (!request?.paths?.length && !request?.scenarioName) return undefined
  return {
    ...(request.paths?.length ? { paths: [...request.paths] } : {}),
    ...(request.scenarioName ? { scenarioName: request.scenarioName } : {}),
  }
}

async function studioCatalog(
  context: StudioProjectContext,
  config: PickleConfig,
  specifications: readonly Specification[],
  namespaces: readonly string[],
): Promise<StudioSpecification[]> {
  return Promise.all(
    specifications.map(async (specification) => {
      const specReady = await studioRunReadiness(
        context,
        { paths: [specification.source.uri] },
        config,
        specifications,
      )
      const scenarios = await Promise.all(
        specification.scenarios.map(async (scenario) => {
          const scenarioReady = await studioRunReadiness(
            context,
            {
              paths: [specification.source.uri],
              scenarioName: scenario.name,
            },
            config,
            specifications,
          )
          return {
            id: scenario.id ?? scenario.name,
            name: scenario.name,
            canRun: scenarioReady.ready,
          }
        }),
      )
      return {
        id: specification.id ?? specification.source.uri,
        name: specification.name,
        uri: specification.source.uri,
        ...(specification.state ? { state: specification.state } : {}),
        tags: authorTags(specification.tags, namespaces),
        links: parseExternalLinks(specification.tags, namespaces),
        canRun: specReady.ready,
        runReasons: specReady.reasons,
        scenarios,
      }
    }),
  )
}

function profileDetails(config: PickleConfig): StudioProfile[] {
  if (config.executionTargetProfiles) {
    return Object.entries(config.executionTargetProfiles).map(
      ([id, profile]) => ({
        id,
        adapter: profile.adapter,
        ...(profile.capabilities
          ? { capabilities: [...profile.capabilities] }
          : {}),
        ...(profile.mobile
          ? {
              mobile: {
                ...profile.mobile,
                executionTarget:
                  profile.mobile.executionTarget ?? 'android-emulator',
                application: { ...profile.mobile.application },
                artifacts: profile.mobile.artifacts
                  ? [...profile.mobile.artifacts]
                  : undefined,
                redactions: profile.mobile.redactions?.map((redaction) => ({
                  ...redaction,
                })),
              },
            }
          : {}),
      }),
    )
  }
  const profile = config.executionTargetProfile
  return [
    {
      id: profile?.id ?? (config.web ? 'web' : 'custom'),
      adapter: profile?.adapter ?? (config.web ? 'web' : 'custom'),
      ...(profile?.capabilities
        ? { capabilities: [...profile.capabilities] }
        : {}),
    },
  ]
}

function suiteDetails(config: PickleConfig): StudioSuite[] {
  return Object.entries(config.suites ?? {}).map(([name, query]) => ({
    name,
    ...(query.paths ? { paths: query.paths } : {}),
    ...(query.tagExpression ? { tagExpression: query.tagExpression } : {}),
    ...(query.states ? { states: [...query.states] } : {}),
    ...(query.scenarioName ? { scenarioName: query.scenarioName } : {}),
  }))
}

function stubAdapter(capabilities?: readonly string[]): ExecutionTargetAdapter {
  return {
    ...(capabilities ? { capabilities: [...capabilities] } : {}),
    async openSession() {
      throw new Error('Studio run validation does not open sessions')
    },
  }
}

export async function studioRunReadiness(
  context: StudioProjectContext,
  request: StudioRunRequest | undefined,
  config: PickleConfig,
  specifications: readonly Specification[],
): Promise<StudioRunReadiness> {
  const reasons: string[] = []
  try {
    const suiteSelection = request?.suite
      ? config.suites?.[request.suite]
      : undefined
    if (request?.suite && !suiteSelection) {
      reasons.push(`Unknown test suite "${request.suite}"`)
    }
    const selection = {
      ...suiteSelection,
      ...studioRunSelection(request),
    }
    const selections = selectScenarios(specifications, selection)
    if (selections.length === 0) {
      reasons.push('No Scenarios match the current selection')
    }
    const runConfiguration = runConfigurationFrom(config, request?.profiles)
    const profiles =
      runConfiguration.executionTargetProfiles ??
      (runConfiguration.executionTargetProfile
        ? [runConfiguration.executionTargetProfile]
        : [])
    if (profiles.length === 0) {
      reasons.push(
        'A test run must select at least one execution target profile',
      )
    }
    const targets = profiles.map((profile) => ({
      executionTargetProfile: profile,
      adapter: stubAdapter(profile.capabilities),
    }))
    validateTargetSelection(selections, targets)
    const usesWeb = profileDetails(config).some(
      (profile) => profile.adapter === 'web',
    )
    if (usesWeb) {
      const secretNames = Object.keys(config.secrets ?? {})
      let present = Boolean(
        config.web?.browser?.modelApiKey ||
          process.env.OPENAI_API_KEY ||
          process.env.ANTHROPIC_API_KEY ||
          process.env.GOOGLE_API_KEY ||
          process.env.GEMINI_API_KEY ||
          process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      )
      if (!present) {
        for (const [name, ref] of Object.entries(config.secrets ?? {})) {
          if (
            process.env[name] ||
            (await context.credentials.has(ref.keychain))
          ) {
            present = true
            break
          }
        }
      }
      if (!present && secretNames.length === 0) {
        reasons.push(
          'Store a model credential in the system keychain before a web test run',
        )
      } else if (!present) {
        reasons.push('The referenced model credential is not available')
      }
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error))
  }
  return { ready: reasons.length === 0, reasons }
}

export async function loadStudioProject(
  context: StudioProjectContext,
): Promise<StudioProject> {
  const config = await loadConfig(context.configPath, context.root)
  const namespaces = Object.keys(config.links ?? {})
  const specifications = await loadProjectSpecifications(
    config.specifications ?? defaultSpecificationGlob,
    config.language,
    context.root,
  )
  const profiles = profileDetails(config)
  const secrets: StudioCredential[] = []
  for (const [name, ref] of Object.entries(config.secrets ?? {})) {
    secrets.push({
      name,
      present:
        Boolean(process.env[name]) ||
        (await context.credentials.has(ref.keychain)),
    })
  }
  return {
    name: basename(context.root),
    root: context.root,
    profiles: profiles.map((profile) => profile.id),
    suites: suiteDetails(config).map((suite) => suite.name),
    specifications: await studioCatalog(
      context,
      config,
      specifications,
      namespaces,
    ),
    links: config.links ?? {},
    suiteDetails: suiteDetails(config),
    profileDetails: profiles,
    secrets,
    readiness: await studioRunReadiness(
      context,
      undefined,
      config,
      specifications,
    ),
  }
}

export async function patchStudioConfig(
  context: StudioProjectContext,
  patch: StudioConfigPatch,
): Promise<StudioProject> {
  const config = await loadConfig(context.configPath, context.root)
  const next: PickleConfig = { ...config }
  if (patch.suites) next.suites = patch.suites
  if (patch.links) next.links = patch.links
  if (patch.secrets) next.secrets = patch.secrets
  if (patch.executionTargetProfiles) {
    const existing = config.executionTargetProfiles ?? {}
    const profiles: Record<string, ProjectExecutionTargetProfile> = {}
    for (const [id, profile] of Object.entries(patch.executionTargetProfiles)) {
      profiles[id] = {
        adapter: profile.adapter,
        ...(profile.capabilities
          ? { capabilities: [...profile.capabilities] }
          : {}),
        ...(existing[id]?.web ? { web: existing[id].web } : {}),
        ...(profile.mobile
          ? {
              mobile: {
                ...profile.mobile,
                application: { ...profile.mobile.application },
              },
            }
          : profile.adapter === 'mobile' && existing[id]?.mobile
            ? { mobile: existing[id].mobile }
            : {}),
      }
    }
    next.executionTargetProfiles = profiles
    next.executionTargetProfile = undefined
  }
  await saveConfig(next, context.configPath, context.root)
  return loadStudioProject(context)
}

export async function saveStudioCredential(
  context: StudioProjectContext,
  input: { name: string; secret: string },
): Promise<StudioProject> {
  const name = input.name.trim()
  const secret = input.secret.trim()
  if (!name) throw new Error('A credential name is required')
  if (!secret) throw new Error('A credential secret is required')
  await context.credentials.set(name, secret)
  const config = await loadConfig(context.configPath, context.root)
  await saveConfig(
    {
      ...config,
      secrets: {
        ...config.secrets,
        [name]: { keychain: name },
      },
    },
    context.configPath,
    context.root,
  )
  return loadStudioProject(context)
}

export async function resolveConfigSecrets(
  config: PickleConfig,
  credentials: CredentialStore,
): Promise<PickleConfig> {
  if (!config.web) return config
  if (config.web.browser?.modelApiKey) return config
  let modelApiKey: string | undefined
  for (const [name, ref] of Object.entries(config.secrets ?? {})) {
    const value =
      process.env[name]?.trim() || (await credentials.get(ref.keychain))
    if (value) {
      modelApiKey = value
      break
    }
  }
  if (!modelApiKey) return config
  return {
    ...config,
    web: {
      ...config.web,
      browser: {
        ...config.web.browser,
        modelApiKey,
      },
    },
  }
}
