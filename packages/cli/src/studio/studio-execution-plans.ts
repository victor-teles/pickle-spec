import type {
  ExecutionCacheEntryMetadata,
  ExecutionCacheEntrySnapshot,
  ExecutionCacheEnvelope,
  ExecutionCacheKey,
  ExecutionPlanDisplay,
  ExecutionPlanStepDisplay,
  ExecutionTargetProfile,
  LocalExecutionCache,
  LocalExecutionPlanStore,
  PlanRevision,
  PlanScope,
  PlanUnavailableReason,
} from '@pickle-spec/runner'
import {
  canonicalJson,
  deserializeExecutionCacheEnvelope,
  openLocalExecutionCache,
  openLocalExecutionPlanStore,
  planDigest,
  requiredVariablesAreValid,
} from '@pickle-spec/runner'
import {
  type Scenario,
  type Specification,
  scenarioRevision,
} from '@pickle-spec/spec'
import type {
  StudioExecutionPlanDraftResult,
  StudioExecutionPlanEditRequest,
  StudioExecutionPlanGateway,
  StudioExecutionPlanRequest,
} from '@pickle-spec/studio'
import {
  parseWebExecutionCachePayload,
  projectWebExecutionPlan,
  replaceWebInteractionTarget,
  resolveFidelityPolicy,
  type WebAdapterOptions,
  type WebExecutionCachePayload,
  type WebLocator,
  webTargetConfigurationFingerprint,
} from '@pickle-spec/web'
import { z } from 'zod'
import { resolveApplicationRevision } from '../configuration/application-revision'
import {
  defaultSpecificationGlob,
  type PickleConfig,
  type ProjectExecutionTargetProfile,
  runConfigurationFrom,
} from '../configuration/config'
import {
  loadProjectSpecifications,
  scenarioSelectionId,
} from '../run/execute-run'

interface ExecutionPlanProject {
  config: PickleConfig
  specifications: readonly Specification[]
  unsupportedProfileIds?: ReadonlySet<string>
}

export interface ExecutionPlanAdapterOverrides {
  adapterIds: ReadonlySet<string>
  hasDefaultAdapter: boolean
}

export interface ExecutionPlanServiceDependencies {
  loadProject(): Promise<ExecutionPlanProject>
  openCache(): Promise<LocalExecutionCache>
  openPlanStore?: () => Promise<LocalExecutionPlanStore>
  resolveApplicationRevision(value: string | undefined): string | undefined
  now?: () => Date
}

interface ResolvedPlanContext {
  scenario: Scenario
  profile: ProjectExecutionTargetProfile
  profileId: string
  scenarioId: string
  scenarioRevision: string
  applicationRevision?: string
}

const sourceNotice =
  'This is the current cache entry. Its source run identifies publication metadata and does not prove that a historical attempt used these bytes.'
const webPayloadValidator = {
  adapterKind: 'web',
  adapterCacheSchemaVersion: '1',
  parse: parseWebExecutionCachePayload,
  prefixStepCount: (
    payload: NonNullable<ReturnType<typeof parseWebExecutionCachePayload>>,
  ) => payload.steps.length,
}

function unavailable(
  reason: Extract<ExecutionPlanDisplay, { state: 'unavailable' }>['reason'],
  message: string,
  nextAction: string,
  applicationRevisions?: readonly string[],
): ExecutionPlanDisplay {
  const result: ExecutionPlanDisplay = {
    state: 'unavailable',
    reason,
    message,
    nextAction,
  }
  return applicationRevisions ? { ...result, applicationRevisions } : result
}

function scenarioFor(
  specifications: readonly Specification[],
  scenarioId: string,
): Scenario | undefined {
  for (const specification of specifications) {
    for (const scenario of specification.scenarios) {
      if (scenarioSelectionId({ specification, scenario }) === scenarioId) {
        return scenario
      }
    }
  }
  return undefined
}

function profileFor(
  config: PickleConfig,
  profileId: string,
): ProjectExecutionTargetProfile | undefined {
  let resolvedProfiles: readonly ExecutionTargetProfile[] | undefined
  try {
    resolvedProfiles = config.executionTargetProfiles
      ? runConfigurationFrom(config, [profileId]).executionTargetProfiles
      : runConfigurationFrom(config).executionTargetProfiles
  } catch {
    return undefined
  }
  const resolved = resolvedProfiles?.find((profile) => profile.id === profileId)
  if (!resolved) return undefined
  return {
    adapter:
      resolved.adapter ??
      ((config.executionTargetProfiles?.[profileId]?.web ?? config.web)
        ? 'web'
        : 'custom'),
    capabilities: resolved.capabilities,
    web: config.executionTargetProfiles?.[profileId]?.web ?? config.web,
  }
}

function webOptions(
  config: PickleConfig,
  profile: ProjectExecutionTargetProfile,
): WebAdapterOptions | undefined {
  return profile.web ?? config.web
}

function matchingCandidate(
  entry: ExecutionCacheEntryMetadata,
  expected: Omit<ExecutionCacheKey, 'applicationRevision'>,
): boolean {
  const { key } = entry
  return (
    key.projectKey === expected.projectKey &&
    key.scenarioId === expected.scenarioId &&
    key.scenarioRevision === expected.scenarioRevision &&
    key.executionTargetProfileId === expected.executionTargetProfileId &&
    key.targetConfigurationFingerprint ===
      expected.targetConfigurationFingerprint &&
    key.adapterKind === expected.adapterKind &&
    key.adapterCacheSchemaVersion === expected.adapterCacheSchemaVersion
  )
}

function distinctApplicationRevisions(
  entries: readonly ExecutionCacheEntryMetadata[],
): string[] {
  return [
    ...new Set(entries.map((entry) => entry.key.applicationRevision)),
  ].toSorted()
}

function sameScenarioAndProfile(
  entry: ExecutionCacheEntryMetadata,
  expected: Omit<ExecutionCacheKey, 'applicationRevision'>,
): boolean {
  return (
    entry.key.projectKey === expected.projectKey &&
    entry.key.scenarioId === expected.scenarioId &&
    entry.key.executionTargetProfileId === expected.executionTargetProfileId
  )
}

function sourceDigest(source: string): string {
  return new Bun.CryptoHasher('sha256').update(source).digest('hex')
}

async function coordinatedEntry(
  cache: LocalExecutionCache,
  selected: ExecutionCacheEntryMetadata,
): Promise<
  | {
      snapshot: ExecutionCacheEntrySnapshot
      metadata: ExecutionCacheEntryMetadata
    }
  | undefined
> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await cache.coordination.readCurrent(selected.key)
    if (!before) return undefined
    const { applicationRevision, ...expected } = selected.key
    const metadata = (await cache.inspect()).find(
      (entry) =>
        matchingCandidate(entry, expected) &&
        entry.key.applicationRevision === applicationRevision,
    )
    const after = await cache.coordination.readCurrent(selected.key)
    if (
      after &&
      before.revision === after.revision &&
      before.source === after.source &&
      metadata?.payloadDigest === sourceDigest(after.source)
    ) {
      return { snapshot: after, metadata }
    }
  }
  return undefined
}

async function resolveContext(
  request: StudioExecutionPlanRequest,
  project: ExecutionPlanProject,
  resolveRevision: ExecutionPlanServiceDependencies['resolveApplicationRevision'],
): Promise<ResolvedPlanContext | ExecutionPlanDisplay> {
  const scenario = scenarioFor(project.specifications, request.scenarioId)
  if (!scenario) {
    return unavailable(
      'scenario-not-found',
      'The Scenario is not present in the current project.',
      'Reload Specifications and choose an available Scenario.',
    )
  }
  const profile = profileFor(project.config, request.profileId)
  if (!profile) {
    return unavailable(
      'unknown-profile',
      'The execution target profile is not present in the current project.',
      'Choose a configured execution target profile.',
    )
  }
  if (profile.adapter !== 'web') {
    return unavailable(
      'unsupported-adapter',
      `Readable execution plans are not available for the ${profile.adapter} adapter.`,
      'Run this Scenario with a web profile or inspect its existing run evidence.',
    )
  }
  if (project.unsupportedProfileIds?.has(request.profileId)) {
    return unavailable(
      'unsupported-adapter',
      'This profile uses a custom execution adapter whose plan format is not available for inspection.',
      'Inspect existing run evidence or use a built-in web profile.',
    )
  }
  return {
    scenario,
    profile,
    profileId: request.profileId,
    scenarioId: request.scenarioId,
    scenarioRevision: scenarioRevision(scenario),
    applicationRevision: resolveRevision(project.config.applicationRevision),
  }
}

async function readPlan(
  request: StudioExecutionPlanRequest,
  dependencies: ExecutionPlanServiceDependencies,
): Promise<ExecutionPlanDisplay> {
  const selected = await loadSelectedWebCache(request, dependencies)
  if ('state' in selected) return selected
  return projectSelectedPlan(selected, selected.context)
}

interface SelectedWebCache {
  cache: LocalExecutionCache
  selected: ExecutionCacheEntryMetadata
  snapshot: ExecutionCacheEntrySnapshot
  metadata: ExecutionCacheEntryMetadata
  envelope: ExecutionCacheEnvelope<WebExecutionCachePayload>
  context: ResolvedPlanContext
}

async function loadSelectedWebCache(
  request: StudioExecutionPlanRequest,
  dependencies: ExecutionPlanServiceDependencies,
): Promise<SelectedWebCache | ExecutionPlanDisplay> {
  const project = await dependencies.loadProject()
  const context = await resolveContext(
    request,
    project,
    dependencies.resolveApplicationRevision,
  )
  if ('state' in context) return context
  const options = webOptions(project.config, context.profile)
  if (!options) {
    return unavailable(
      'unsupported-adapter',
      'The web profile has no web adapter configuration.',
      'Configure the web profile and run the Scenario to create a cache entry.',
    )
  }
  const selected = await selectWebCacheEntry(
    request,
    context,
    options,
    dependencies,
  )
  if ('state' in selected) return selected
  const current = await coordinatedEntry(selected.cache, selected.entry)
  if (!current) {
    return {
      state: 'absent',
      nextAction: 'Run this Scenario again to recreate its cache entry.',
    }
  }
  const envelope = deserializeExecutionCacheEnvelope({
    source: current.snapshot.source,
    expectedKey: selected.entry.key,
    payloadValidator: webPayloadValidator,
  })
  if (invalidEnvelope(envelope, context.scenario)) {
    return unavailable(
      'incompatible-cache-entry',
      'The cached plan is invalid or incompatible with the current Scenario.',
      'Run this Scenario again to replace this cache entry.',
    )
  }
  if (!envelope) throw new Error('Unreachable invalid execution plan envelope')
  return {
    cache: selected.cache,
    selected: selected.entry,
    snapshot: current.snapshot,
    metadata: current.metadata,
    envelope,
    context,
  }
}

async function selectWebCacheEntry(
  request: StudioExecutionPlanRequest,
  context: ResolvedPlanContext,
  options: WebAdapterOptions,
  dependencies: ExecutionPlanServiceDependencies,
): Promise<
  | { cache: LocalExecutionCache; entry: ExecutionCacheEntryMetadata }
  | ExecutionPlanDisplay
> {
  const cache = await dependencies.openCache()
  if (!cache.coordination) {
    return unavailable(
      'coordination-unavailable',
      'The execution cache cannot provide a coordinated read-only snapshot.',
      'Use the local execution cache and try again.',
    )
  }
  const targetConfigurationFingerprint = webTargetConfigurationFingerprint({
    options,
    behavior: {},
    fidelity: resolveFidelityPolicy(options),
  })
  const expected = {
    projectKey: cache.projectKey,
    scenarioId: context.scenarioId,
    scenarioRevision: context.scenarioRevision,
    executionTargetProfileId: context.profileId,
    targetConfigurationFingerprint,
    adapterKind: 'web',
    adapterCacheSchemaVersion: '1',
  }
  const allEntries = await cache.inspect()
  const candidates = allEntries.filter((entry) =>
    matchingCandidate(entry, expected),
  )
  const relatedEntries = allEntries.filter((entry) =>
    sameScenarioAndProfile(entry, expected),
  )
  const selected = selectCandidate(request, context, candidates)
  if ('state' in selected) return selected
  if (!selected.entry) {
    return missingPlan(relatedEntries.length > 0)
  }
  return { cache, entry: selected.entry }
}

function selectCandidate(
  request: StudioExecutionPlanRequest,
  context: ResolvedPlanContext,
  candidates: readonly ExecutionCacheEntryMetadata[],
): { entry?: ExecutionCacheEntryMetadata } | ExecutionPlanDisplay {
  if (context.applicationRevision) {
    const selectedEntry = candidates.find(
      (candidate) =>
        candidate.key.applicationRevision === context.applicationRevision,
    )
    if (!selectedEntry && candidates.length > 0) {
      return unavailable(
        'incompatible-cache-entry',
        'Cached plans exist, but none matches the configured application revision.',
        'Run the Scenario against the configured application revision.',
      )
    }
    return { entry: selectedEntry }
  }
  if (request.applicationRevision) {
    return {
      entry: candidates.find(
        (entry) =>
          entry.key.applicationRevision === request.applicationRevision,
      ),
    }
  }
  if (candidates.length === 1) return { entry: candidates[0] }
  if (candidates.length > 1) {
    return unavailable(
      'ambiguous-application-revision',
      'More than one cached application revision matches this Scenario and profile.',
      'Choose an application revision to inspect.',
      distinctApplicationRevisions(candidates),
    )
  }
  return {}
}

function missingPlan(hasRelatedEntry: boolean): ExecutionPlanDisplay {
  if (hasRelatedEntry) {
    return unavailable(
      'incompatible-cache-entry',
      'Cached plans exist for this Scenario and profile, but they do not match the current Specification or adapter configuration.',
      'Run the current Scenario again to create a compatible plan.',
    )
  }
  return {
    state: 'absent',
    nextAction:
      'Run this Scenario with the selected profile to create a readable plan.',
  }
}

function invalidEnvelope(
  envelope: ExecutionCacheEnvelope<WebExecutionCachePayload> | undefined,
  scenario: Scenario,
): boolean {
  return (
    !envelope ||
    envelope.adapterPayload.steps.length > scenario.steps.length ||
    !requiredVariablesAreValid(envelope.requiredVariables, scenario)
  )
}

async function projectSelectedPlan(
  selected: SelectedWebCache,
  context: ResolvedPlanContext,
): Promise<ExecutionPlanDisplay> {
  const definitionSteps =
    context.scenario.template?.steps ?? context.scenario.steps
  let steps: readonly ExecutionPlanStepDisplay[]
  try {
    steps = projectWebExecutionPlan(
      selected.envelope.adapterPayload,
      definitionSteps,
    )
  } catch {
    return unavailable(
      'incompatible-cache-entry',
      'The cached plan does not match the current Gherkin step roles.',
      'Run the current Scenario again to replace this cache entry.',
    )
  }
  return {
    state: 'available',
    source: 'current-cache-entry',
    sourceNotice,
    publication: { sourceRunId: selected.metadata.sourceRunId },
    cacheKey: selected.selected.key,
    cacheRevision: selected.snapshot.revision,
    applicability: context.applicationRevision
      ? { state: 'applicable' }
      : {
          state: 'unverified',
          reason: 'current-deployment-unverified',
          storedApplicationRevision: selected.selected.key.applicationRevision,
        },
    requiredVariables: selected.envelope.requiredVariables,
    steps,
    uncachedTail: definitionSteps
      .slice(selected.envelope.adapterPayload.steps.length)
      .map((step, offset) => ({
        index: selected.envelope.adapterPayload.steps.length + offset,
        keyword: step.keyword,
        text: step.text,
      })),
  }
}

const draftSourceNotice =
  'Authored execution-plan draft. It is immutable history and does not change active execution.'

function scopeFromKey(key: ExecutionCacheKey): PlanScope {
  const { projectKey: _projectKey, ...scope } = key
  return scope
}

function draftFailure(
  message: string,
  reason: PlanUnavailableReason = 'invalid-payload',
): StudioExecutionPlanDraftResult {
  return { ok: false, reason, message }
}

function displayFailure(
  display: ExecutionPlanDisplay,
): StudioExecutionPlanDraftResult {
  if (display.state === 'absent') {
    return draftFailure(
      `There is no cached web plan to capture. ${display.nextAction}`,
      'incomplete-plan',
    )
  }
  if (display.state === 'unavailable') {
    return draftFailure(
      `${display.message} ${display.nextAction}`,
      'inapplicable',
    )
  }
  return draftFailure('The execution plan is not editable', 'invalid-payload')
}

function projectDraft(
  revision: PlanRevision,
  context: ResolvedPlanContext,
): StudioExecutionPlanDraftResult {
  const definitionSteps =
    context.scenario.template?.steps ?? context.scenario.steps
  let steps: readonly ExecutionPlanStepDisplay[]
  try {
    const jsonPayload = z.json().safeParse(revision.adapterPayload)
    if (!jsonPayload.success)
      return draftFailure('The draft web payload is invalid')
    const payload = parseWebExecutionCachePayload(
      jsonPayload.data,
      revision.requiredVariables,
    )
    if (!payload) return draftFailure('The draft web payload is invalid')
    steps = projectWebExecutionPlan(payload, definitionSteps)
    return {
      ok: true,
      value: {
        state: 'draft',
        revisionId: revision.id,
        parentRevisionId:
          revision.origin.kind === 'revision'
            ? (revision.origin.revisionId ?? null)
            : null,
        sourceNotice: draftSourceNotice,
        scope: revision.scope,
        requiredVariables: revision.requiredVariables,
        steps,
        uncachedTail: definitionSteps
          .slice(payload.steps.length)
          .map((step, offset) => ({
            index: payload.steps.length + offset,
            keyword: step.keyword,
            text: step.text,
          })),
      },
    }
  } catch {
    return draftFailure('The draft does not match the current Scenario')
  }
}

async function captureDraft(
  request: StudioExecutionPlanRequest,
  dependencies: ExecutionPlanServiceDependencies,
): Promise<StudioExecutionPlanDraftResult> {
  if (!dependencies.openPlanStore) {
    return draftFailure(
      'Editable execution plans are unavailable',
      'unsupported-adapter',
    )
  }
  const selected = await loadSelectedWebCache(request, dependencies)
  if ('state' in selected) return displayFailure(selected)
  const store = await dependencies.openPlanStore()
  const content = {
    formatVersion: 1 as const,
    scope: scopeFromKey(selected.selected.key),
    origin: {
      kind: 'cache-capture' as const,
      payloadDigest: planDigest(selected.envelope.adapterPayload),
    },
    author: { kind: 'human' as const, id: 'studio' },
    createdAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    requiredVariables: [...selected.envelope.requiredVariables],
    steps: selected.envelope.adapterPayload.steps.map((_, index) => ({
      scenarioRevision: selected.context.scenarioRevision,
      index,
    })),
    adapterPayload: selected.envelope.adapterPayload,
    assertionBaselineRevisionId: null,
  }
  const created = await store.createRevision(content)
  if (!created.ok) return created
  return projectDraft(created.value, selected.context)
}

function revisionApplies(
  revisionScope: PlanScope,
  context: ResolvedPlanContext,
  project: ExecutionPlanProject,
): boolean {
  const options = webOptions(project.config, context.profile)
  if (!options) return false
  const expectedScope = {
    ...revisionScope,
    scenarioId: context.scenarioId,
    scenarioRevision: context.scenarioRevision,
    executionTargetProfileId: context.profileId,
    targetConfigurationFingerprint: webTargetConfigurationFingerprint({
      options,
      behavior: {},
      fidelity: resolveFidelityPolicy(options),
    }),
    adapterKind: 'web',
    adapterCacheSchemaVersion: '1',
  }
  if (context.applicationRevision !== undefined) {
    expectedScope.applicationRevision = context.applicationRevision
  }
  return canonicalJson(revisionScope) === canonicalJson(expectedScope)
}

async function createEditedRevision(
  store: LocalExecutionPlanStore,
  parent: PlanRevision,
  edited: Extract<ReturnType<typeof replaceWebInteractionTarget>, { ok: true }>,
  now: () => Date,
) {
  return store.createRevision({
    formatVersion: 1,
    scope: parent.scope,
    origin: { kind: 'revision', revisionId: parent.id },
    author: { kind: 'human', id: 'studio' },
    createdAt: now().toISOString(),
    requiredVariables: [...parent.requiredVariables],
    steps: [...parent.steps],
    adapterPayload: edited.value,
    assertionBaselineRevisionId:
      parent.assertionBaselineRevisionId ?? parent.id,
  })
}

async function editDraft(
  request: StudioExecutionPlanEditRequest,
  dependencies: ExecutionPlanServiceDependencies,
): Promise<StudioExecutionPlanDraftResult> {
  if (!dependencies.openPlanStore) {
    return draftFailure(
      'Editable execution plans are unavailable',
      'unsupported-adapter',
    )
  }
  const project = await dependencies.loadProject()
  const context = await resolveContext(
    request,
    project,
    dependencies.resolveApplicationRevision,
  )
  if ('state' in context) return displayFailure(context)
  const store = await dependencies.openPlanStore()
  const parent = await store.readRevision(request.parentRevisionId)
  if (!parent.ok) return parent
  if (!parent.value)
    return draftFailure('The parent draft was not found', 'missing-revision')
  if (!revisionApplies(parent.value.scope, context, project)) {
    return draftFailure(
      'The parent draft does not apply to this Scenario',
      'inapplicable',
    )
  }
  const payloadSource = z.json().safeParse(parent.value.adapterPayload)
  const payload = payloadSource.success
    ? parseWebExecutionCachePayload(
        payloadSource.data,
        parent.value.requiredVariables,
      )
    : undefined
  if (!payload) {
    return draftFailure(
      'The parent draft payload is invalid',
      'invalid-payload',
    )
  }
  const edited = replaceWebInteractionTarget(
    payload,
    parent.value.steps,
    parent.value.requiredVariables,
    {
      step: request.step,
      instructionIndex: request.instructionIndex,
      expectedInstructionDigest: request.expectedInstructionDigest,
      locator: request.locator,
    },
  )
  if (!edited.ok) return edited
  const next = await createEditedRevision(
    store,
    parent.value,
    edited,
    dependencies.now ?? (() => new Date()),
  )
  if (!next.ok) return next
  return projectDraft(next.value, context)
}

export function createStudioExecutionPlanService(
  dependencies: ExecutionPlanServiceDependencies,
): StudioExecutionPlanGateway {
  return {
    read: (request) => readPlan(request, dependencies),
    captureDraft: (request) => captureDraft(request, dependencies),
    edit: (request) => editDraft(request, dependencies),
  }
}

export function createStudioExecutionPlanGateway(
  projectRoot: string,
  configPath?: string,
  cacheRoot = process.env.PICKLE_CACHE_ROOT,
  overrides?: ExecutionPlanAdapterOverrides,
): StudioExecutionPlanGateway {
  return createStudioExecutionPlanService({
    async loadProject() {
      const { loadConfig } = await import('../configuration/config')
      const config = await loadConfig(configPath, projectRoot)
      const specifications = await loadProjectSpecifications(
        config.specifications ?? defaultSpecificationGlob,
        config.language,
        projectRoot,
      )
      const profileIds = config.executionTargetProfiles
        ? Object.keys(config.executionTargetProfiles)
        : [config.executionTargetProfile?.id ?? (config.web ? 'web' : 'custom')]
      const unsupportedProfileIds = new Set(
        profileIds.filter((id) => {
          if (overrides?.adapterIds.has(id)) return true
          const configuredAdapter =
            config.executionTargetProfiles?.[id]?.adapter ??
            config.executionTargetProfile?.adapter
          if (configuredAdapter === 'web') {
            return overrides?.adapterIds.has('web') ?? false
          }
          return !configuredAdapter && (overrides?.hasDefaultAdapter ?? false)
        }),
      )
      return { config, specifications, unsupportedProfileIds }
    },
    openCache: () => openLocalExecutionCache({ projectRoot, cacheRoot }),
    openPlanStore: () => openLocalExecutionPlanStore({ projectRoot }),
    resolveApplicationRevision: (value) =>
      resolveApplicationRevision(value, projectRoot),
  })
}
