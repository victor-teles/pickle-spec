import { randomUUID } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  unlink,
} from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import {
  parseUniqueKeyJson,
  serializePlanDocument,
} from './execution-plan-json'
import type { Digest } from './execution-plan-revision'
import { isDigest } from './execution-plan-revision'

type NodeError = Error & { code?: string }

export interface PlanStorePaths {
  projectRoot: string
  revisionsDirectory: string
  selectionsDirectory: string
  runtimePlansDirectory: string
}

interface LockRecord {
  formatVersion: 1
  ownerToken: string
  hostname: string
  pid: number
}

export interface HeldPlanLock {
  path: string
  record: LockRecord
}

const lockRecordSchema = z.strictObject({
  formatVersion: z.literal(1),
  ownerToken: z.string().uuid(),
  hostname: z.string().min(1),
  pid: z.number().int().positive().safe(),
})

export class PlanStorageBoundaryError extends Error {}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeError).code === code
}

async function pathKind(
  path: string,
): Promise<'absent' | 'directory' | 'file' | 'unsafe'> {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) return 'unsafe'
    if (stat.isDirectory()) return 'directory'
    if (stat.isFile()) return 'file'
    return 'unsafe'
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return 'absent'
    throw error
  }
}

function directoryParts(paths: PlanStorePaths, target: string): string[] {
  const relativeTarget = relative(paths.projectRoot, target)
  if (
    isAbsolute(relativeTarget) ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`)
  ) {
    throw new PlanStorageBoundaryError('Managed directory escaped its root')
  }
  return relativeTarget === '' ? [] : relativeTarget.split(sep)
}

async function ensureDirectory(path: string, name: string) {
  const kind = await pathKind(path)
  if (kind === 'directory') return
  if (kind !== 'absent') {
    throw new PlanStorageBoundaryError(
      `Managed directory ${name} is not a directory`,
    )
  }
  try {
    await mkdir(path, { mode: 0o700 })
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error
    if ((await pathKind(path)) !== 'directory') {
      throw new PlanStorageBoundaryError(
        `Managed directory ${name} is not a directory`,
      )
    }
  }
}

export async function ensureDirectoryChain(
  paths: PlanStorePaths,
  target: string,
) {
  let current = paths.projectRoot
  for (const part of directoryParts(paths, target)) {
    current = join(current, part)
    await ensureDirectory(current, part)
  }
}

export async function verifyDirectoryChain(
  paths: PlanStorePaths,
  target: string,
): Promise<boolean> {
  let current = paths.projectRoot
  for (const part of directoryParts(paths, target)) {
    current = join(current, part)
    const kind = await pathKind(current)
    if (kind === 'absent') return false
    if (kind !== 'directory') {
      throw new PlanStorageBoundaryError(
        `Managed directory ${part} is not a directory`,
      )
    }
  }
  return true
}

export async function readRegularFile(
  path: string,
): Promise<string | undefined> {
  const kind = await pathKind(path)
  if (kind === 'absent') return undefined
  if (kind !== 'file') {
    throw new PlanStorageBoundaryError(
      `${basename(path)} is not a regular file`,
    )
  }
  return readFile(path, 'utf8')
}

export async function listManagedFiles(directory: string): Promise<string[]> {
  return (await readdir(directory)).toSorted()
}

export async function flushDirectory(path: string) {
  let handle: FileHandle | undefined
  try {
    handle = await open(path, 'r')
    await handle.sync()
  } catch (error) {
    const unsupported = ['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].some((code) =>
      hasCode(error, code),
    )
    if (!unsupported) throw error
  } finally {
    await handle?.close()
  }
}

export async function writeFlushedFile(path: string, source: string) {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(source, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export function managedPath(
  directory: string,
  id: Digest,
  extension: string,
): string {
  if (!isDigest(id)) {
    throw new PlanStorageBoundaryError('Expected a lowercase SHA-256 digest')
  }
  const path = join(directory, `${id}${extension}`)
  if (dirname(path) !== directory) {
    throw new PlanStorageBoundaryError('Managed path escaped its directory')
  }
  return path
}

export async function removeOwnedTemporary(path: string) {
  try {
    await unlink(path)
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error
  }
}

export async function publishImmutableFile(
  directory: string,
  id: Digest,
  source: string,
): Promise<'created' | 'exists'> {
  const finalPath = managedPath(directory, id, '.json')
  const temporaryPath = join(directory, `.${id}.${randomUUID()}.tmp`)
  await writeFlushedFile(temporaryPath, source)
  try {
    await link(temporaryPath, finalPath)
    await flushDirectory(directory)
    return 'created'
  } catch (error) {
    if (hasCode(error, 'EEXIST')) return 'exists'
    throw error
  } finally {
    await removeOwnedTemporary(temporaryPath)
  }
}

function processExited(pid: number): boolean | undefined {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    if (hasCode(error, 'ESRCH')) return true
    return undefined
  }
}

async function inspectExistingLock(
  path: string,
): Promise<'retry' | 'wait' | 'conflict'> {
  const source = await readRegularFile(path)
  if (source === undefined) return 'retry'
  let record: LockRecord
  try {
    record = lockRecordSchema.parse(parseUniqueKeyJson(source))
  } catch {
    return 'conflict'
  }
  if (record.hostname !== hostname()) return 'conflict'
  const exited = processExited(record.pid)
  if (exited === undefined) return 'conflict'
  if (!exited) return 'wait'
  const latestSource = await readRegularFile(path)
  if (latestSource !== source) return 'wait'
  await removeOwnedTemporary(path)
  return 'retry'
}

async function createLock(path: string, record: LockRecord): Promise<boolean> {
  try {
    await writeFlushedFile(path, serializePlanDocument(record))
    return true
  } catch (error) {
    if (hasCode(error, 'EEXIST')) return false
    throw error
  }
}

export async function acquirePlanLock(
  paths: PlanStorePaths,
  slotId: Digest,
  lockWaitMs: number,
): Promise<HeldPlanLock | undefined> {
  await ensureDirectoryChain(paths, paths.runtimePlansDirectory)
  const path = managedPath(paths.runtimePlansDirectory, slotId, '.lock')
  const deadline = Date.now() + lockWaitMs
  while (true) {
    const record: LockRecord = {
      formatVersion: 1,
      ownerToken: randomUUID(),
      hostname: hostname(),
      pid: process.pid,
    }
    if (await createLock(path, record)) {
      await flushDirectory(paths.runtimePlansDirectory)
      return { path, record }
    }
    const state = await inspectExistingLock(path)
    if (state === 'conflict') return undefined
    if (state === 'retry') continue
    if (Date.now() >= deadline) return undefined
    await delay(Math.min(10, Math.max(1, deadline - Date.now())))
  }
}

export async function releasePlanLock(
  paths: PlanStorePaths,
  lock: HeldPlanLock,
) {
  const source = await readRegularFile(lock.path)
  if (source === undefined) return
  try {
    const current = lockRecordSchema.parse(parseUniqueKeyJson(source))
    if (current.ownerToken !== lock.record.ownerToken) return
  } catch {
    return
  }
  await removeOwnedTemporary(lock.path)
  await flushDirectory(paths.runtimePlansDirectory)
}
