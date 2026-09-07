import { randomUUID } from 'node:crypto'
import { realpath, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  canonicalJson,
  createPlanRevision,
  parsePlanRevision,
  parsePlanSelection,
  parseUniqueKeyJson,
  planSlotId,
  selectionDigest,
  serializePlanDocument,
} from './execution-plan-json'
import type {
  Actor,
  Digest,
  PlanResult,
  PlanRevision,
  PlanRevisionContent,
  PlanScope,
  PlanSelection,
  PlanUnavailableReason,
} from './execution-plan-revision'
import { isDigest, planRevisionContentSchema } from './execution-plan-revision'
import type { HeldPlanLock, PlanStorePaths } from './local-plan-files'
import {
  acquirePlanLock,
  ensureDirectoryChain,
  flushDirectory,
  listManagedFiles,
  managedPath,
  PlanStorageBoundaryError,
  publishImmutableFile,
  readRegularFile,
  releasePlanLock,
  removeOwnedTemporary,
  verifyDirectoryChain,
  writeFlushedFile,
} from './local-plan-files'

export interface PlanSelectionRecord {
  value: PlanSelection
  digest: Digest
}

export interface UnavailablePlanRevision {
  revisionId: string
  reason: 'unsupported-format' | 'invalid-payload'
  message: string
}

export type PlanSelectionInspection =
  | { state: 'absent' }
  | { state: 'available'; record: PlanSelectionRecord }
  | {
      state: 'unavailable'
      reason: 'unsupported-format' | 'invalid-payload' | 'missing-revision'
      message: string
    }

export interface PlanRevisionHistory {
  selection: PlanSelectionInspection
  revisions: readonly PlanRevision[]
  unavailableRevisions: readonly UnavailablePlanRevision[]
}

export interface WritePlanSelectionInput {
  scope: PlanScope
  active: { revisionId: Digest } | null
  expectedSelectionDigest: Digest | null
  actor: Actor
  reason: 'activate' | 'rollback' | 'deactivate'
}

export type WritePlanSelectionResult =
  | { ok: true; value: PlanSelectionRecord }
  | {
      ok: false
      reason: PlanUnavailableReason
      message: string
      current?: PlanSelectionRecord | null
    }

export interface LocalExecutionPlanStore {
  createRevision(
    content: PlanRevisionContent,
  ): Promise<PlanResult<PlanRevision>>
  readRevision(id: Digest): Promise<PlanResult<PlanRevision | null>>
  inspect(scope: PlanScope): Promise<PlanResult<PlanRevisionHistory>>
  writeSelection(
    input: WritePlanSelectionInput,
  ): Promise<WritePlanSelectionResult>
}

export interface LocalExecutionPlanStoreOptions {
  projectRoot: string
  now?: () => Date
  lockWaitMs?: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unavailableReason(
  source: string,
): 'unsupported-format' | 'invalid-payload' {
  try {
    const decoded = parseUniqueKeyJson(source)
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      'formatVersion' in decoded &&
      (decoded as Record<string, unknown>).formatVersion !== 1
    ) {
      return 'unsupported-format'
    }
  } catch {
    return 'invalid-payload'
  }
  return 'invalid-payload'
}

function failure(
  reason: PlanUnavailableReason,
  message: string,
): { ok: false; reason: PlanUnavailableReason; message: string } {
  return { ok: false, reason, message }
}

function scopeEquals(left: PlanScope, right: PlanScope): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function parseScope(scope: PlanScope): PlanResult<PlanScope> {
  const parsed = planRevisionContentSchema.shape.scope.safeParse(scope)
  if (!parsed.success)
    return failure('invalid-payload', 'Plan scope is invalid')
  return { ok: true, value: parsed.data }
}

class FilesystemExecutionPlanStore implements LocalExecutionPlanStore {
  constructor(
    private readonly paths: PlanStorePaths,
    private readonly now: () => Date,
    private readonly lockWaitMs: number,
  ) {}

  async createRevision(
    content: PlanRevisionContent,
  ): Promise<PlanResult<PlanRevision>> {
    let revision: PlanRevision
    try {
      revision = createPlanRevision(content)
    } catch (error) {
      return failure(
        'invalid-payload',
        `Revision is invalid: ${errorMessage(error)}`,
      )
    }
    try {
      await ensureDirectoryChain(this.paths, this.paths.revisionsDirectory)
      const source = serializePlanDocument(revision)
      const publication = await publishImmutableFile(
        this.paths.revisionsDirectory,
        revision.id,
        source,
      )
      if (publication === 'exists') {
        return this.verifyExistingRevision(revision, source)
      }
      return { ok: true, value: revision }
    } catch (error) {
      return this.boundaryFailure(error)
    }
  }

  async readRevision(id: Digest): Promise<PlanResult<PlanRevision | null>> {
    try {
      if (!isDigest(id)) {
        return failure(
          'invalid-payload',
          'Revision ID is not a lowercase SHA-256 digest',
        )
      }
      if (
        !(await verifyDirectoryChain(this.paths, this.paths.revisionsDirectory))
      ) {
        return { ok: true, value: null }
      }
      const path = managedPath(this.paths.revisionsDirectory, id, '.json')
      const source = await readRegularFile(path)
      if (source === undefined) return { ok: true, value: null }
      return this.parseRevisionSource(id, source)
    } catch (error) {
      return this.boundaryFailure(error)
    }
  }

  async inspect(scope: PlanScope): Promise<PlanResult<PlanRevisionHistory>> {
    const parsedScope = parseScope(scope)
    if (!parsedScope.ok) return parsedScope
    try {
      const history = await this.readHistory(parsedScope.value)
      const selection = await this.inspectSelection(parsedScope.value)
      return { ok: true, value: { ...history, selection } }
    } catch (error) {
      return this.boundaryFailure(error)
    }
  }

  async writeSelection(
    input: WritePlanSelectionInput,
  ): Promise<WritePlanSelectionResult> {
    if (
      input.expectedSelectionDigest !== null &&
      !isDigest(input.expectedSelectionDigest)
    ) {
      return failure('invalid-payload', 'Expected selection digest is invalid')
    }
    const scope = parseScope(input.scope)
    if (!scope.ok) return scope
    const slotId = planSlotId(scope.value)
    let lock: HeldPlanLock | undefined
    try {
      lock = await acquirePlanLock(this.paths, slotId, this.lockWaitMs)
      if (lock === undefined) {
        return failure('write-conflict', `Plan slot ${slotId} is locked`)
      }
      return await this.writeSelectionUnderLock(slotId, scope.value, input)
    } catch (error) {
      return this.boundaryFailure(error)
    } finally {
      if (lock !== undefined) await releasePlanLock(this.paths, lock)
    }
  }

  private async verifyExistingRevision(
    revision: PlanRevision,
    expectedSource: string,
  ): Promise<PlanResult<PlanRevision>> {
    const path = managedPath(
      this.paths.revisionsDirectory,
      revision.id,
      '.json',
    )
    const source = await readRegularFile(path)
    if (source === undefined)
      return failure('invalid-payload', 'Revision disappeared')
    const parsed = this.parseRevisionSource(revision.id, source)
    if (!parsed.ok || parsed.value === null)
      return parsed as PlanResult<PlanRevision>
    if (source !== expectedSource) {
      return failure(
        'invalid-payload',
        'Stored revision does not have canonical bytes',
      )
    }
    return { ok: true, value: parsed.value }
  }

  private parseRevisionSource(
    id: Digest,
    source: string,
  ): PlanResult<PlanRevision | null> {
    try {
      return { ok: true, value: parsePlanRevision(source, id) }
    } catch (error) {
      return failure(
        unavailableReason(source),
        `Revision ${id} is unavailable: ${errorMessage(error)}`,
      )
    }
  }

  private async readHistory(scope: PlanScope) {
    const revisions: PlanRevision[] = []
    const unavailableRevisions: UnavailablePlanRevision[] = []
    if (await verifyDirectoryChain(this.paths, this.paths.revisionsDirectory)) {
      for (const name of await listManagedFiles(
        this.paths.revisionsDirectory,
      )) {
        await this.readHistoryFile(name, scope, revisions, unavailableRevisions)
      }
    }
    revisions.sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id),
    )
    unavailableRevisions.sort((left, right) =>
      left.revisionId.localeCompare(right.revisionId),
    )
    return { revisions, unavailableRevisions }
  }

  private async readHistoryFile(
    name: string,
    scope: PlanScope,
    revisions: PlanRevision[],
    unavailable: UnavailablePlanRevision[],
  ) {
    if (!name.endsWith('.json')) return
    const revisionId = name.slice(0, -'.json'.length)
    if (!isDigest(revisionId)) {
      unavailable.push({
        revisionId,
        reason: 'invalid-payload',
        message: 'Revision filename is not a lowercase SHA-256 digest',
      })
      return
    }
    let source: string | undefined
    try {
      source = await readRegularFile(join(this.paths.revisionsDirectory, name))
    } catch (error) {
      unavailable.push({
        revisionId,
        reason: 'invalid-payload',
        message: `Revision is unavailable: ${errorMessage(error)}`,
      })
      return
    }
    if (source === undefined) return
    const result = this.parseRevisionSource(revisionId, source)
    if (result.ok && result.value !== null) {
      if (scopeEquals(result.value.scope, scope)) revisions.push(result.value)
      return
    }
    if (!result.ok) {
      unavailable.push({
        revisionId,
        reason: unavailableReason(source),
        message: result.message,
      })
    }
  }

  private async inspectSelection(
    scope: PlanScope,
  ): Promise<PlanSelectionInspection> {
    const result = await this.readSelection(planSlotId(scope))
    if (!result.ok) return this.unavailableSelection(result)
    if (result.value === null) return { state: 'absent' }
    const active = result.value.value.active
    if (active === null) return { state: 'available', record: result.value }
    const revision = await this.readRevision(active.revisionId)
    if (!revision.ok) return this.unavailableSelection(revision)
    if (revision.value === null) {
      return this.missingSelectionRevision(
        'Selection references a missing revision',
      )
    }
    if (!scopeEquals(revision.value.scope, scope)) {
      return this.missingSelectionRevision('Selection references another slot')
    }
    return { state: 'available', record: result.value }
  }

  private unavailableSelection(result: {
    reason: PlanUnavailableReason
    message: string
  }): PlanSelectionInspection {
    const reason =
      result.reason === 'unsupported-format'
        ? 'unsupported-format'
        : 'invalid-payload'
    return { state: 'unavailable', reason, message: result.message }
  }

  private missingSelectionRevision(message: string): PlanSelectionInspection {
    return { state: 'unavailable', reason: 'missing-revision', message }
  }

  private async readSelection(
    slotId: Digest,
  ): Promise<PlanResult<PlanSelectionRecord | null>> {
    if (
      !(await verifyDirectoryChain(this.paths, this.paths.selectionsDirectory))
    ) {
      return { ok: true, value: null }
    }
    const path = managedPath(this.paths.selectionsDirectory, slotId, '.json')
    const source = await readRegularFile(path)
    if (source === undefined) return { ok: true, value: null }
    try {
      const value = parsePlanSelection(source)
      return { ok: true, value: { value, digest: selectionDigest(value) } }
    } catch (error) {
      return failure(
        unavailableReason(source),
        `Selection ${slotId} is unavailable: ${errorMessage(error)}`,
      )
    }
  }

  private async writeSelectionUnderLock(
    slotId: Digest,
    scope: PlanScope,
    input: WritePlanSelectionInput,
  ): Promise<WritePlanSelectionResult> {
    const currentResult = await this.readSelection(slotId)
    if (!currentResult.ok) return currentResult
    const current = currentResult.value
    if ((current?.digest ?? null) !== input.expectedSelectionDigest) {
      return {
        ok: false,
        reason: 'write-conflict',
        message: 'Selection changed since it was inspected',
        current,
      }
    }
    const referencedRevision = await this.verifySelectionRevision(
      input.active,
      scope,
    )
    if (!referencedRevision.ok) return referencedRevision
    const selection = this.nextSelection(input, current)
    let digest: Digest
    try {
      digest = selectionDigest(selection)
    } catch (error) {
      return failure(
        'invalid-payload',
        `Selection is invalid: ${errorMessage(error)}`,
      )
    }
    await this.publishSelection(slotId, selection)
    return { ok: true, value: { value: selection, digest } }
  }

  private async verifySelectionRevision(
    active: { revisionId: Digest } | null,
    scope: PlanScope,
  ): Promise<PlanResult<true>> {
    if (active === null) return { ok: true, value: true }
    const revision = await this.readRevision(active.revisionId)
    if (!revision.ok) return revision
    if (revision.value === null) {
      return failure(
        'missing-revision',
        'Selection references a missing revision',
      )
    }
    if (!scopeEquals(revision.value.scope, scope)) {
      return failure(
        'inapplicable',
        'Selected revision belongs to another scope',
      )
    }
    return { ok: true, value: true }
  }

  private nextSelection(
    input: WritePlanSelectionInput,
    current: PlanSelectionRecord | null,
  ): PlanSelection {
    return {
      formatVersion: 1,
      generation: (current?.value.generation ?? 0) + 1,
      active: input.active,
      createdAt: this.now().toISOString(),
      previousSelectionDigest: current?.digest ?? null,
      actor: input.actor,
      reason: input.reason,
    }
  }

  private async publishSelection(slotId: Digest, selection: PlanSelection) {
    await ensureDirectoryChain(this.paths, this.paths.selectionsDirectory)
    const finalPath = managedPath(
      this.paths.selectionsDirectory,
      slotId,
      '.json',
    )
    const temporaryPath = join(
      this.paths.selectionsDirectory,
      `.${slotId}.${randomUUID()}.tmp`,
    )
    await writeFlushedFile(temporaryPath, serializePlanDocument(selection))
    try {
      await rename(temporaryPath, finalPath)
      await flushDirectory(this.paths.selectionsDirectory)
    } finally {
      await removeOwnedTemporary(temporaryPath)
    }
  }

  private boundaryFailure<T>(error: unknown): PlanResult<T> {
    if (error instanceof PlanStorageBoundaryError) {
      return failure('invalid-payload', error.message)
    }
    throw error
  }
}

export async function openLocalExecutionPlanStore(
  options: LocalExecutionPlanStoreOptions,
): Promise<LocalExecutionPlanStore> {
  const projectRoot = await realpath(resolve(options.projectRoot))
  const pickleDirectory = join(projectRoot, '.pickle')
  const plansDirectory = join(pickleDirectory, 'plans')
  return new FilesystemExecutionPlanStore(
    {
      projectRoot,
      revisionsDirectory: join(plansDirectory, 'revisions'),
      selectionsDirectory: join(plansDirectory, 'selections'),
      runtimePlansDirectory: join(pickleDirectory, 'runtime', 'plans'),
    },
    options.now ?? (() => new Date()),
    options.lockWaitMs ?? 1_000,
  )
}
