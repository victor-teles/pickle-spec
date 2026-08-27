import { resolve, sep } from 'node:path'
import { resolveLocalProjectStorage } from '@pickle-spec/runner'

export type StudioArtifactPath =
  | { kind: 'ready'; path: string }
  | { kind: 'missing-query' }
  | { kind: 'forbidden' }

function containedIn(path: string, directory: string): boolean {
  const resolved = resolve(path)
  const root = resolve(directory)
  return resolved === root || resolved.startsWith(`${root}${sep}`)
}

export function resolveStudioArtifactPath(
  filePath: string | null,
  projectRoot: string,
): StudioArtifactPath {
  if (!filePath) return { kind: 'missing-query' }
  const resolved = resolve(filePath)
  const storage = resolveLocalProjectStorage(projectRoot)
  if (!containedIn(resolved, storage.projectDirectory)) {
    return { kind: 'forbidden' }
  }
  return { kind: 'ready', path: resolved }
}
