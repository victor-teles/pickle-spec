export function resolveApplicationRevision(
  configuredRevision: string | undefined,
  projectRoot: string,
): string | undefined {
  if (configuredRevision !== 'git:HEAD') return configuredRevision
  const resolved = Bun.spawnSync({
    cmd: ['git', 'rev-parse', '--verify', 'HEAD'],
    cwd: projectRoot,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const revision = resolved.stdout.toString().trim()
  if (resolved.exitCode !== 0 || !revision) {
    throw new Error(
      'applicationRevision "git:HEAD" requires a Git repository with a commit',
    )
  }
  return revision
}
