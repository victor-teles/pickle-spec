import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

export interface LocalProjectStorage {
  projectKey: string
  pickleHome: string
  projectDirectory: string
  runsDirectory: string
  archivesDirectory: string
  runIndexPath: string
  executionCachePath: string
}

function canonicalPath(path: string): string {
  const canonical = realpathSync(resolve(path))
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

function gitDirectory(projectRoot: string): string | undefined {
  const dotGit = join(projectRoot, '.git')
  if (!existsSync(dotGit)) return undefined
  try {
    const contents = readFileSync(dotGit, 'utf8').trim()
    if (!contents.startsWith('gitdir:')) return canonicalPath(dotGit)
    const path = contents.slice('gitdir:'.length).trim()
    return canonicalPath(isAbsolute(path) ? path : resolve(projectRoot, path))
  } catch {
    return canonicalPath(dotGit)
  }
}

function gitCommonDirectory(projectRoot: string): string | undefined {
  const directory = gitDirectory(projectRoot)
  if (!directory) return undefined
  const commonDirectoryFile = join(directory, 'commondir')
  if (!existsSync(commonDirectoryFile)) return directory
  const path = readFileSync(commonDirectoryFile, 'utf8').trim()
  return canonicalPath(isAbsolute(path) ? path : resolve(directory, path))
}

function projectIdentity(projectRoot: string): string {
  const canonicalProjectRoot = canonicalPath(projectRoot)
  return gitCommonDirectory(canonicalProjectRoot) ?? canonicalProjectRoot
}

export function localProjectKey(projectRoot: string): string {
  return createHash('sha256').update(projectIdentity(projectRoot)).digest('hex')
}

function projectDirectoryName(projectRoot: string, projectKey: string): string {
  const identity = projectIdentity(projectRoot)
  const projectName = basename(
    basename(identity) === '.git' ? dirname(identity) : identity,
  )
  const slug = projectName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'project'}-${projectKey.slice(0, 12)}`
}

export function resolveLocalProjectStorage(
  projectRoot: string,
  pickleHome = process.env.PICKLE_HOME ?? join(homedir(), '.pickle'),
): LocalProjectStorage {
  const projectKey = localProjectKey(projectRoot)
  const canonicalPickleHome = resolve(pickleHome)
  const projectDirectory = join(
    canonicalPickleHome,
    'projects',
    projectDirectoryName(projectRoot, projectKey),
  )
  return {
    projectKey,
    pickleHome: canonicalPickleHome,
    projectDirectory,
    runsDirectory: join(projectDirectory, 'runs'),
    archivesDirectory: join(projectDirectory, 'archives'),
    runIndexPath: join(projectDirectory, 'index.sqlite'),
    executionCachePath: join(canonicalPickleHome, 'execution-cache.sqlite'),
  }
}
