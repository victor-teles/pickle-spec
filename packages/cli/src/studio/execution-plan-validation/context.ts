import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  canonicalJson,
  localProjectKey,
  openLocalExecutionPlanStore,
  openLocalPlanValidationStore,
  openTestRunStore,
  requiredVariablesAreValid,
  validationBasisDigest,
  type ExecutionCacheKey,
  type PlanRevision,
  type PlanUnavailableReason,
} from '@pickle-spec/runner'
import { scenarioRevision } from '@pickle-spec/spec'
import {
  projectWebExecutionPlan,
  validateWebExecutionPlanCandidate,
  webPlanValidatorVersion,
} from '@pickle-spec/web'
import { resolveApplicationRevision } from '../../configuration/application-revision'
import {
  defaultConfigFile,
  defaultExtensionsFile,
  type PickleConfig,
} from '../../configuration/config'
import { loadExtensions } from '../../run/execute-run'
import {
  prepareRunSelection,
  scenarioSelectionId,
} from '../../run/project-run/selection'
import {
  disposeProjectRunTargets,
  resolveProjectRunConfiguration,
} from '../../run/project-run/targets'
import { z } from 'zod'

function candidateMatchesKey(key: ExecutionCacheKey, revision: PlanRevision) {
  return (
    canonicalJson(key) ===
    canonicalJson({ projectKey: key.projectKey, ...revision.scope })
  )
}

function stepsMatchScenario(
  revision: PlanRevision,
  scenarioRevisionValue: string,
) {
  return !revision.steps.some(
    (step, index) =>
      step.index !== index || step.scenarioRevision !== scenarioRevisionValue,
  )
}

interface InputSnapshotDigestInput {
  root: string
  project: PlanValidationProject
  config: PickleConfig
  selection: Awaited<
    ReturnType<typeof prepareRunSelection>
  >['selections'][number]
  applicationRevision: string
  profileId: string
  configurationFingerprint: string
  local: Awaited<ReturnType<typeof openLocalPlanValidationStore>>
}

async function inputSnapshotDigest(input: InputSnapshotDigestInput) {
  const digester = await input.local.inputSnapshotDigester()
  const [configurationSource, extensionSource, specificationSource] =
    await Promise.all([
      optionalSource(
        resolve(input.root, input.project.configPath ?? defaultConfigFile),
      ),
      optionalSource(
        resolve(
          input.root,
          input.project.extensionsPath ?? defaultExtensionsFile,
        ),
      ),
      Bun.file(
        resolve(input.root, input.selection.specification.source.uri),
      ).text(),
    ])
  return digester.digest({
    formatVersion: 1,
    resolvedConfiguration: z.json().parse(
      JSON.parse(
        JSON.stringify({
          config: input.config,
          configurationSource,
          extensionSource,
        }),
      ),
    ),
    specificationSource: {
      uri: input.selection.specification.source.uri,
      source: specificationSource,
    },
    selectedExamplesRowIds: [
      input.selection.scenario.examplesId,
      input.selection.scenario.examplesRowId,
    ].filter((value): value is string => value !== undefined),
    applicationRevision: input.applicationRevision,
    targetInputs: {
      profileId: input.profileId,
      configurationFingerprint: input.configurationFingerprint,
    },
    runtimeBindings: (input.selection.scenario.runtimeBindings ?? []).map(
      ({ name, value }) => ({ name, value }),
    ),
    validationRequest: {
      statementVersion: 1,
      confirmed: true,
      actor: { kind: 'human', id: 'studio' },
    },
  })
}

export interface PlanValidationProject {
  root: string
  configPath?: string
  extensionsPath?: string
  loadConfig(): Promise<PickleConfig>
}

export class PlanValidationError extends Error {
  constructor(
    readonly reason: PlanUnavailableReason,
    message: string,
  ) {
    super(message)
  }
}

function assertSupportedRevision(revision: PlanRevision) {
  if (
    revision.scope.adapterKind !== 'web' ||
    revision.scope.adapterCacheSchemaVersion !== '1'
  ) {
    throw new PlanValidationError(
      'unsupported-adapter',
      'Complete candidate validation currently supports web plans only.',
    )
  }
}

function selectedScenario(
  selected: Awaited<ReturnType<typeof prepareRunSelection>>,
) {
  const selection = selected.selections[0]
  if (selected.selections.length !== 1 || !selection) {
    throw new PlanValidationError(
      'inapplicable',
      'Validation requires exactly one complete Scenario, including one selected Examples row.',
    )
  }
  return selection
}

function assertBuiltInWebAdapter(
  extensions: Awaited<ReturnType<typeof loadExtensions>>,
  profileId: string,
) {
  if (
    extensions.adapter ||
    extensions.adapters?.web ||
    extensions.adapters?.[profileId]
  ) {
    throw new PlanValidationError(
      'unsupported-adapter',
      'Candidate validation requires the built-in web adapter.',
    )
  }
}

async function readRevision(root: string, revisionId: string) {
  const store = await openLocalExecutionPlanStore({ projectRoot: root })
  const loaded = await store.readRevision(revisionId)
  if (!loaded.ok) throw new PlanValidationError(loaded.reason, loaded.message)
  if (!loaded.value)
    throw new PlanValidationError(
      'missing-revision',
      'The saved candidate revision is missing.',
    )
  return loaded.value
}

async function assertionBaseline(root: string, revision: PlanRevision) {
  const baselineId = revision.assertionBaselineRevisionId ?? revision.id
  let current = revision
  const visited = new Set<string>()
  while (current.origin.kind === 'revision') {
    if (visited.has(current.id))
      throw new PlanValidationError(
        'invalid-payload',
        'The candidate history contains a cycle.',
      )
    visited.add(current.id)
    if (current.assertionBaselineRevisionId !== baselineId) {
      throw new PlanValidationError(
        'assertion-change',
        'The candidate changed its assertion baseline.',
      )
    }
    current = await readRevision(root, current.origin.revisionId)
    if (
      canonicalJson(current.scope) !== canonicalJson(revision.scope) ||
      canonicalJson(current.requiredVariables) !==
        canonicalJson(revision.requiredVariables) ||
      canonicalJson(current.steps) !== canonicalJson(revision.steps)
    ) {
      throw new PlanValidationError(
        'assertion-change',
        'The candidate changed its scope, step identities, or required inputs.',
      )
    }
  }
  if (
    current.id !== baselineId ||
    current.assertionBaselineRevisionId !== null
  ) {
    throw new PlanValidationError(
      'assertion-change',
      'The immutable assertion baseline does not match the candidate history.',
    )
  }
  return current
}

async function optionalSource(path: string) {
  return (await Bun.file(path).exists()) ? Bun.file(path).text() : null
}

export function checkoutHead(root: string): string | null {
  const result = Bun.spawnSync({
    cmd: ['git', 'rev-parse', '--verify', 'HEAD'],
    cwd: root,
    stdout: 'pipe',
    stderr: 'ignore',
  })
  return result.exitCode === 0 ? result.stdout.toString().trim() : null
}

export async function resolvePlanValidation(
  project: PlanValidationProject,
  revisionId: string,
) {
  const root = await realpath(project.root)
  const revision = await readRevision(root, revisionId)
  assertSupportedRevision(revision)
  const baseline = await assertionBaseline(root, revision)
  const config = await project.loadConfig()
  const applicationRevision = resolveApplicationRevision(
    config.applicationRevision,
    root,
  )
  if (!applicationRevision)
    throw new PlanValidationError(
      'inapplicable',
      'Configure an application revision before validating a candidate.',
    )
  const options = {
    profiles: [revision.scope.executionTargetProfileId],
    scenarioIds: [revision.scope.scenarioId],
    extensionsPath: project.extensionsPath,
  }
  const selected = await prepareRunSelection(
    openTestRunStore({ root }),
    root,
    config,
    options,
  )
  const selection = selectedScenario(selected)
  const extensions = await loadExtensions(project.extensionsPath, root)
  assertBuiltInWebAdapter(extensions, revision.scope.executionTargetProfileId)
  const configured = await resolveProjectRunConfiguration({
    config,
    args: options,
    applicationRevision,
    profileIds: options.profiles,
    root,
  })
  try {
    const target = configured.targets[0]
    const adapter = target?.adapter.executionCache
    if (
      configured.targets.length !== 1 ||
      !target ||
      !adapter ||
      adapter.adapterKind !== 'web'
    ) {
      throw new PlanValidationError(
        'unsupported-adapter',
        'The selected target cannot validate a complete web Replay plan.',
      )
    }
    const key: ExecutionCacheKey = {
      projectKey: localProjectKey(root),
      scenarioId: scenarioSelectionId(selection),
      scenarioRevision: scenarioRevision(selection.scenario),
      executionTargetProfileId: target.executionTargetProfile.id,
      targetConfigurationFingerprint: adapter.targetConfigurationFingerprint,
      applicationRevision,
      adapterKind: adapter.adapterKind,
      adapterCacheSchemaVersion: adapter.adapterCacheSchemaVersion,
    }
    if (!candidateMatchesKey(key, revision)) {
      throw new PlanValidationError(
        'inapplicable',
        'The candidate no longer matches the current Scenario, profile, configuration, or application revision.',
      )
    }
    const definitionSteps =
      selection.scenario.template?.steps ?? selection.scenario.steps
    if (
      !stepsMatchScenario(revision, key.scenarioRevision) ||
      !stepsMatchScenario(baseline, key.scenarioRevision)
    ) {
      throw new PlanValidationError(
        'inapplicable',
        'The candidate step identities no longer match this Scenario.',
      )
    }
    const bound = new Set(
      selection.scenario.runtimeBindings?.map((binding) => binding.name),
    )
    if (
      !requiredVariablesAreValid(
        revision.requiredVariables,
        selection.scenario,
      ) ||
      revision.requiredVariables.some((name) => !bound.has(name))
    ) {
      throw new PlanValidationError(
        'incomplete-plan',
        'The candidate is missing required runtime inputs. Select the complete Examples row before validation.',
      )
    }
    const validated = validateWebExecutionPlanCandidate({
      baselinePayload: baseline.adapterPayload,
      candidatePayload: revision.adapterPayload,
      steps: revision.steps,
      scenarioSteps: definitionSteps,
      scenarioRevision: key.scenarioRevision,
      requiredVariables: revision.requiredVariables,
    })
    if (!validated.ok)
      throw new PlanValidationError(validated.reason, validated.message)
    const local = await openLocalPlanValidationStore({ projectRoot: root })
    const snapshotDigest = await inputSnapshotDigest({
      root,
      project,
      config,
      selection,
      applicationRevision,
      profileId: target.executionTargetProfile.id,
      configurationFingerprint: adapter.targetConfigurationFingerprint,
      local,
    })
    return {
      root,
      config,
      options,
      revision,
      baseline,
      key,
      local,
      selection,
      inputSnapshotDigest: snapshotDigest,
      assertionDigest: validated.value.assertionDigest,
      adapterValidatorVersion: webPlanValidatorVersion,
      payload: validated.value.payload,
      candidateSteps: projectWebExecutionPlan(
        validated.value.payload,
        definitionSteps,
      ),
      baselineSteps: projectWebExecutionPlan(
        validated.value.baselinePayload,
        definitionSteps,
      ),
    }
  } finally {
    await disposeProjectRunTargets(configured.targets)
  }
}

export type ResolvedPlanValidation = Awaited<
  ReturnType<typeof resolvePlanValidation>
>

export function validationBasis(
  context: ResolvedPlanValidation,
  intentReviewDigest: string,
) {
  return validationBasisDigest({
    revisionId: context.revision.id,
    key: context.key,
    inputSnapshotDigest: context.inputSnapshotDigest,
    assertionDigest: context.assertionDigest,
    intentReviewDigest,
    adapterValidatorVersion: context.adapterValidatorVersion,
  })
}
