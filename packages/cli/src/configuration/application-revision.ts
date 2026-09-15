import { spawnSync } from 'node:child_process'
export function resolveApplicationRevision(
  configuredRevision: string | undefined,
  projectRoot: string,
): string | undefined {
  if (configuredRevision !== 'git:HEAD') return configuredRevision
  const resolved = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const revision = (resolved.stdout ?? '').trim()
  if (resolved.status !== 0 || !revision) {
    throw new Error(
      'applicationRevision "git:HEAD" requires a Git repository with a commit',
    )
  }
  return revision
}
