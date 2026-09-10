import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  open,
  readFile,
  realpath,
  rename,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  canonicalJson,
  parseUniqueKeyJson,
  planDigest,
  planSlotId,
  serializePlanDocument,
} from './execution-plan-json'
import type {
  Digest,
  IntentReview,
  PlanResult,
  PlanScope,
  ValidationHead,
  ValidationReceipt,
  JsonValue,
} from './execution-plan-revision'
import {
  intentReviewSchema,
  validationHeadSchema,
  validationReceiptSchema,
} from './execution-plan-revision'
import type { HeldPlanLock, PlanStorePaths } from './local-plan-files'
import {
  acquirePlanLock,
  ensureDirectoryChain,
  flushDirectory,
  managedPath,
  PlanStorageBoundaryError,
  publishImmutableFile,
  readRegularFile,
  releasePlanLock,
  removeOwnedTemporary,
  verifyDirectoryChain,
  writeFlushedFile,
} from './local-plan-files'

export interface InputSnapshotDigester {
  digest(snapshot: ValidationInputSnapshot): Digest
}

export interface ValidationInputSnapshot {
  formatVersion: 1
  resolvedConfiguration: JsonValue
  specificationSource: JsonValue
  selectedExamplesRowIds: readonly string[]
  applicationRevision: string
  targetInputs: JsonValue
  runtimeBindings: readonly { name: string; value: string }[]
  validationRequest: JsonValue
}

export interface PublishValidationInput {
  scope: PlanScope
  basisDigest: Digest
  run: ValidationHead['run']
  outcome: ValidationHead['outcome']
  receipt: Omit<ValidationReceipt, 'id'> | null
}

export interface PublishedValidation {
  head: ValidationHead
  receipt: ValidationReceipt | null
}

export interface LocalPlanValidationStore {
  inputSnapshotDigester(): Promise<InputSnapshotDigester>
  writeReview(
    review: IntentReview,
  ): Promise<PlanResult<{ id: Digest; review: IntentReview }>>
  readReview(id: Digest): Promise<PlanResult<IntentReview | null>>
  readHead(basisDigest: Digest): Promise<PlanResult<ValidationHead | null>>
  readReceipt(id: Digest): Promise<PlanResult<ValidationReceipt | null>>
  publish(
    input: PublishValidationInput,
  ): Promise<PlanResult<PublishedValidation>>
}

interface ValidationPaths extends PlanStorePaths {
  reviewsDirectory: string
  receiptsDirectory: string
  headsDirectory: string
  inputKeyPath: string
}

interface LocalPlanValidationStoreOptions {
  projectRoot: string
  lockWaitMs?: number
}

function failure(
  reason: 'invalid-payload' | 'write-conflict',
  message: string,
) {
  return { ok: false as const, reason, message }
}

async function safeKey(paths: ValidationPaths): Promise<Buffer> {
  await ensureDirectoryChain(paths, paths.runtimePlansDirectory)
  try {
    const stat = await lstat(paths.inputKeyPath)
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
      throw new PlanStorageBoundaryError(
        'Input snapshot key is not a private regular file',
      )
    }
    const key = await readFile(paths.inputKeyPath)
    if (key.length !== 32)
      throw new PlanStorageBoundaryError(
        'Input snapshot key has an invalid length',
      )
    return key
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error
  }
  const key = randomBytes(32)
  try {
    const handle = await open(paths.inputKeyPath, 'wx', 0o600)
    try {
      await handle.writeFile(key)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await chmod(paths.inputKeyPath, 0o600)
    await flushDirectory(paths.runtimePlansDirectory)
    return key
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST'))
      throw error
    return safeKey(paths)
  }
}

async function readDocument<T>(
  paths: ValidationPaths,
  directory: string,
  id: Digest,
  parse: (value: JsonValue) => T,
): Promise<T | null> {
  if (!(await verifyDirectoryChain(paths, directory))) return null
  const source = await readRegularFile(managedPath(directory, id, '.json'))
  return source === undefined ? null : parse(parseUniqueKeyJson(source))
}

export function validationBasisDigest(
  receipt: Pick<
    ValidationReceipt,
    | 'revisionId'
    | 'key'
    | 'inputSnapshotDigest'
    | 'assertionDigest'
    | 'intentReviewDigest'
    | 'adapterValidatorVersion'
  >,
): Digest {
  return planDigest({
    revisionId: receipt.revisionId,
    key: receipt.key,
    inputSnapshotDigest: receipt.inputSnapshotDigest,
    assertionDigest: receipt.assertionDigest,
    intentReviewDigest: receipt.intentReviewDigest,
    adapterValidatorVersion: receipt.adapterValidatorVersion,
  })
}

class FilesystemPlanValidationStore implements LocalPlanValidationStore {
  constructor(
    private readonly paths: ValidationPaths,
    private readonly lockWaitMs: number,
  ) {}

  async inputSnapshotDigester(): Promise<InputSnapshotDigester> {
    const key = await safeKey(this.paths)
    return {
      digest(snapshot) {
        return createHmac('sha256', key)
          .update(canonicalJson(snapshot))
          .digest('hex')
      },
    }
  }

  async writeReview(review: IntentReview) {
    try {
      const parsed = intentReviewSchema.parse(review)
      const id = planDigest(parsed)
      await ensureDirectoryChain(this.paths, this.paths.reviewsDirectory)
      const source = serializePlanDocument(parsed)
      const publication = await publishImmutableFile(
        this.paths.reviewsDirectory,
        id,
        source,
      )
      if (publication === 'exists') {
        const existing = await readRegularFile(
          managedPath(this.paths.reviewsDirectory, id, '.json'),
        )
        if (existing !== source)
          return failure(
            'invalid-payload',
            'Stored review bytes do not match their digest',
          )
      }
      return { ok: true as const, value: { id, review: parsed } }
    } catch (error) {
      return failure(
        'invalid-payload',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  async readReview(id: Digest) {
    try {
      const value = await readDocument(
        this.paths,
        this.paths.reviewsDirectory,
        id,
        (input) => intentReviewSchema.parse(input),
      )
      if (value && planDigest(value) !== id)
        return failure(
          'invalid-payload',
          'Stored review does not match its filename',
        )
      return { ok: true as const, value }
    } catch (error) {
      return failure(
        'invalid-payload',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  async readHead(basisDigest: Digest) {
    try {
      const value = await readDocument(
        this.paths,
        this.paths.headsDirectory,
        basisDigest,
        (input) => validationHeadSchema.parse(input),
      )
      if (value && value.basisDigest !== basisDigest)
        return failure(
          'invalid-payload',
          'Stored validation head does not match its filename',
        )
      return { ok: true as const, value }
    } catch (error) {
      return failure(
        'invalid-payload',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  async readReceipt(id: Digest) {
    try {
      const value = await readDocument(
        this.paths,
        this.paths.receiptsDirectory,
        id,
        (input) => validationReceiptSchema.parse(input),
      )
      if (value) {
        const { id: _id, ...content } = value
        if (value.id !== id || planDigest(content) !== id) {
          return failure(
            'invalid-payload',
            'Stored validation receipt does not match its filename',
          )
        }
      }
      return { ok: true as const, value }
    } catch (error) {
      return failure(
        'invalid-payload',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  async publish(
    input: PublishValidationInput,
  ): Promise<PlanResult<PublishedValidation>> {
    const slotId = planSlotId(input.scope)
    let lock: HeldPlanLock | undefined
    try {
      lock = await acquirePlanLock(this.paths, slotId, this.lockWaitMs)
      if (!lock)
        return failure('write-conflict', `Plan slot ${slotId} is locked`)
      const current = await this.readHead(input.basisDigest)
      if (!current.ok) return current
      const preparedReceipt = await this.prepareReceipt(input)
      if (!preparedReceipt.ok) return preparedReceipt
      const receipt = preparedReceipt.value
      if (
        current.value &&
        current.value.run.projectKey === input.run.projectKey &&
        current.value.run.runId === input.run.runId &&
        current.value.run.resultDigest === input.run.resultDigest &&
        current.value.outcome === input.outcome &&
        current.value.receiptId === (receipt?.id ?? null)
      ) {
        return { ok: true, value: { head: current.value, receipt } }
      }
      const head: ValidationHead = {
        basisDigest: input.basisDigest,
        generation: (current.value?.generation ?? 0) + 1,
        run: input.run,
        outcome: input.outcome,
        receiptId: receipt?.id ?? null,
      }
      await this.writeHead(head)
      return { ok: true, value: { head, receipt } }
    } catch (error) {
      return failure(
        'invalid-payload',
        error instanceof Error ? error.message : String(error),
      )
    } finally {
      if (lock) await releasePlanLock(this.paths, lock)
    }
  }

  private async prepareReceipt(
    input: PublishValidationInput,
  ): Promise<PlanResult<ValidationReceipt | null>> {
    if (input.outcome !== 'passed') {
      return input.receipt
        ? failure(
            'invalid-payload',
            'Only passed validation may issue a receipt',
          )
        : { ok: true, value: null }
    }
    if (!input.receipt) {
      return failure('invalid-payload', 'Passed validation requires a receipt')
    }
    const receipt = validationReceiptSchema.parse({
      ...input.receipt,
      id: planDigest(input.receipt),
    })
    if (
      canonicalJson(receipt.validationRun) !== canonicalJson(input.run) ||
      validationBasisDigest(receipt) !== input.basisDigest
    ) {
      return failure(
        'invalid-payload',
        'Validation receipt does not match the completed run and basis',
      )
    }
    const { projectKey: _projectKey, ...receiptScope } = receipt.key
    if (canonicalJson(receiptScope) !== canonicalJson(input.scope)) {
      return failure(
        'invalid-payload',
        'Validation receipt does not match the plan slot',
      )
    }
    await ensureDirectoryChain(this.paths, this.paths.receiptsDirectory)
    const source = serializePlanDocument(receipt)
    const publication = await publishImmutableFile(
      this.paths.receiptsDirectory,
      receipt.id,
      source,
    )
    if (publication === 'exists') {
      const existing = await readRegularFile(
        managedPath(this.paths.receiptsDirectory, receipt.id, '.json'),
      )
      if (existing !== source) {
        return failure(
          'invalid-payload',
          'Stored receipt bytes do not match their digest',
        )
      }
    }
    return { ok: true, value: receipt }
  }

  private async writeHead(head: ValidationHead) {
    await ensureDirectoryChain(this.paths, this.paths.headsDirectory)
    const path = managedPath(
      this.paths.headsDirectory,
      head.basisDigest,
      '.json',
    )
    const temporary = join(
      this.paths.headsDirectory,
      `.${head.basisDigest}.${randomUUID()}.tmp`,
    )
    await writeFlushedFile(
      temporary,
      serializePlanDocument(validationHeadSchema.parse(head)),
    )
    try {
      await rename(temporary, path)
      await flushDirectory(this.paths.headsDirectory)
    } finally {
      await removeOwnedTemporary(temporary)
    }
  }
}

export async function openLocalPlanValidationStore(
  options: LocalPlanValidationStoreOptions,
): Promise<LocalPlanValidationStore> {
  const projectRoot = await realpath(resolve(options.projectRoot))
  const runtimePlansDirectory = join(projectRoot, '.pickle', 'runtime', 'plans')
  return new FilesystemPlanValidationStore(
    {
      projectRoot,
      revisionsDirectory: join(projectRoot, '.pickle', 'plans', 'revisions'),
      selectionsDirectory: join(projectRoot, '.pickle', 'plans', 'selections'),
      runtimePlansDirectory,
      reviewsDirectory: join(runtimePlansDirectory, 'reviews'),
      receiptsDirectory: join(runtimePlansDirectory, 'validations'),
      headsDirectory: join(runtimePlansDirectory, 'validation-heads'),
      inputKeyPath: join(runtimePlansDirectory, 'input-snapshot.key'),
    },
    options.lockWaitMs ?? 250,
  )
}
