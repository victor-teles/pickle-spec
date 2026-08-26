import { randomUUID } from 'node:crypto'
import {
  link,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

type OutputWriter = (stagedPath: string) => Promise<void>
type NodeError = Error & { code?: string }

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeError).code === 'ENOENT') return false
    throw error
  }
}

function destinationExists(path: string): Error {
  return new Error(`Output destination already exists: ${path}`)
}

async function replaceStagedPath(
  stagedPath: string,
  destination: string,
  backupPath: string,
): Promise<void> {
  const hadDestination = await pathExists(destination)
  if (hadDestination) await rename(destination, backupPath)
  try {
    await rename(stagedPath, destination)
  } catch (error) {
    if (hadDestination) {
      try {
        await rename(backupPath, destination)
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          `Could not publish ${destination}; the previous output remains recoverable at ${backupPath}`,
        )
      }
    }
    throw error
  }
  if (hadDestination) await rm(backupPath, { recursive: true, force: true })
}

async function publishStagedFile(
  stagedPath: string,
  destination: string,
  force: boolean,
  backupPath: string,
): Promise<void> {
  if (force) {
    await replaceStagedPath(stagedPath, destination, backupPath)
    return
  }
  try {
    await link(stagedPath, destination)
    await unlink(stagedPath)
  } catch (error) {
    if ((error as NodeError).code === 'EEXIST')
      throw destinationExists(destination)
    throw error
  }
}

async function publishStagedDirectory(
  stagedPath: string,
  destination: string,
  force: boolean,
  backupPath: string,
): Promise<void> {
  if (!force && (await pathExists(destination))) {
    throw destinationExists(destination)
  }
  if (force) {
    await replaceStagedPath(stagedPath, destination, backupPath)
    return
  }
  try {
    await rename(stagedPath, destination)
  } catch (error) {
    if ((error as NodeError).code === 'EEXIST')
      throw destinationExists(destination)
    throw error
  }
}

export async function publishAtomicOutput(
  destination: string,
  kind: 'file' | 'directory',
  force: boolean,
  write: OutputWriter,
): Promise<void> {
  const parent = dirname(destination)
  await mkdir(parent, { recursive: true })
  const temporaryDirectory = await mkdtemp(
    join(parent, `.${basename(destination)}.pickle-export-`),
  )
  const stagedPath = join(temporaryDirectory, 'output')
  const backupPath = join(
    parent,
    `.${basename(destination)}.pickle-backup-${randomUUID()}`,
  )
  try {
    await write(stagedPath)
    if (kind === 'directory') {
      await publishStagedDirectory(stagedPath, destination, force, backupPath)
    } else {
      await publishStagedFile(stagedPath, destination, force, backupPath)
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}
