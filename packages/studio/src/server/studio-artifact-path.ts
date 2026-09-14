import { constants, realpathSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { resolveLocalProjectStorage } from '@pickle-spec/runner'
import { z } from 'zod'

type ArtifactFileHandle = Awaited<ReturnType<typeof open>>

const errorCodeSchema = z.object({ code: z.string().optional() })

export type StudioArtifactPath =
  | { kind: 'ready'; path: string }
  | { kind: 'missing' }
  | { kind: 'missing-query' }
  | { kind: 'forbidden' }

export type StudioArtifactRead =
  | {
      kind: 'ready'
      body?: ReadableStream
      path: string
      size: number
    }
  | Exclude<StudioArtifactPath, { kind: 'ready' }>

function containedIn(path: string, directory: string): boolean {
  const resolved = resolve(path)
  const root = resolve(directory)
  return resolved === root || resolved.startsWith(`${root}${sep}`)
}

function missingPath(code: string | undefined): boolean {
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function artifactBody(handle: ArtifactFileHandle): ReadableStream<Uint8Array> {
  const reader = Bun.file(handle.fd).stream().getReader()
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await handle.close()
  }
  return new ReadableStream({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {
          controller.close()
          await close()
        } else {
          controller.enqueue(chunk.value)
        }
      } catch (error) {
        controller.error(error)
        await close()
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        await close()
      }
    },
  })
}

function resolvedExistingPath(path: string): StudioArtifactPath {
  try {
    return { kind: 'ready', path: realpathSync(path) }
  } catch (error) {
    return missingPath(errorCodeSchema.safeParse(error).data?.code)
      ? { kind: 'missing' }
      : { kind: 'forbidden' }
  }
}

export function resolveStudioArtifactPath(
  filePath: string | null,
  projectRoot: string,
): StudioArtifactPath {
  if (!filePath) return { kind: 'missing-query' }
  const resolved = resolve(filePath)
  const storage = resolveLocalProjectStorage(projectRoot)
  const physicalStorage = resolvedExistingPath(storage.projectDirectory)
  if (!containedIn(resolved, storage.projectDirectory)) {
    return { kind: 'forbidden' }
  }
  if (physicalStorage.kind !== 'ready') return physicalStorage
  const physicalPath = resolvedExistingPath(resolved)
  if (physicalPath.kind !== 'ready') return physicalPath
  return containedIn(physicalPath.path, physicalStorage.path)
    ? physicalPath
    : { kind: 'forbidden' }
}

export async function readStudioArtifact(
  filePath: string | null,
  projectRoot: string,
  readBody = true,
): Promise<StudioArtifactRead> {
  const resolved = resolveStudioArtifactPath(filePath, projectRoot)
  if (resolved.kind !== 'ready') return resolved
  let handle: ArtifactFileHandle | undefined
  let streamOwnsHandle = false
  try {
    handle = await open(
      resolved.path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    )
    const opened = await handle.stat()
    const currentPath = resolvedExistingPath(resolved.path)
    if (currentPath.kind !== 'ready') return currentPath
    const current = await stat(currentPath.path)
    const storage = resolvedExistingPath(
      resolveLocalProjectStorage(projectRoot).projectDirectory,
    )
    if (
      storage.kind !== 'ready' ||
      !containedIn(currentPath.path, storage.path) ||
      opened.dev !== current.dev ||
      opened.ino !== current.ino
    ) {
      return { kind: 'forbidden' }
    }
    const body = readBody ? artifactBody(handle) : undefined
    streamOwnsHandle = body !== undefined
    return {
      kind: 'ready',
      path: currentPath.path,
      size: opened.size,
      body,
    }
  } catch (error) {
    return missingPath(errorCodeSchema.safeParse(error).data?.code)
      ? { kind: 'missing' }
      : { kind: 'forbidden' }
  } finally {
    if (!streamOwnsHandle) await handle?.close()
  }
}
