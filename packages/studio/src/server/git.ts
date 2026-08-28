import { join } from 'node:path'

export interface StudioGitFile {
  path: string
  status: string
  staged: boolean
  diff: string
}

export interface StudioGitStatus {
  branch?: string
  files: StudioGitFile[]
  pullRequestAvailable: boolean
  pullRequestReason?: string
}

export interface StudioPullRequestResult {
  url?: string
  message: string
}

export interface GitWorkspace {
  status(): Promise<StudioGitStatus>
  stage(paths: readonly string[]): Promise<StudioGitStatus>
  commit(input: {
    message: string
    confirmed: boolean
    paths?: readonly string[]
  }): Promise<StudioGitStatus>
  pullRequest(): Promise<StudioPullRequestResult>
}

function run(
  cwd: string,
  cmd: string[],
): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync({
    cmd,
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode ?? 1,
  }
}

function git(cwd: string, args: string[]) {
  return run(cwd, ['git', ...args])
}

function assertGitSuccess(
  result: { stderr: string; exitCode: number },
  action: string,
) {
  if (result.exitCode === 0) return
  throw new Error(result.stderr.trim() || `Unable to ${action}`)
}

function fileStaged(line: string): boolean {
  const indexStatus = line[0]
  return Boolean(indexStatus && indexStatus !== ' ' && indexStatus !== '?')
}

function fileUnstaged(line: string): boolean {
  const worktreeStatus = line[1]
  return Boolean(worktreeStatus && worktreeStatus !== ' ')
}

async function diffFor(
  root: string,
  path: string,
  staged: boolean,
  untracked: boolean,
) {
  if (untracked) {
    const file = Bun.file(join(root, path))
    if (!(await file.exists())) return ''
    return `${(await file.text())
      .split('\n')
      .map((line) => `+${line}`)
      .join('\n')}\n`
  }
  const result = git(root, [
    'diff',
    '--no-color',
    ...(staged ? ['--cached'] : []),
    '--',
    path,
  ])
  return result.stdout
}

async function pullRequestAvailability(root: string): Promise<{
  available: boolean
  reason?: string
}> {
  if (!Bun.which('gh')) {
    return { available: false, reason: 'GitHub CLI is not available' }
  }
  const remotes = git(root, ['remote', '-v'])
  if (!/github\.com[:/]/i.test(remotes.stdout)) {
    return { available: false, reason: 'No GitHub remote is configured' }
  }
  const upstream = git(root, ['rev-parse', '--abbrev-ref', '@{upstream}'])
  if (upstream.exitCode !== 0) {
    return {
      available: false,
      reason: 'Publish the branch before creating a pull request',
    }
  }
  return { available: true }
}

function statusPath(line: string): string | undefined {
  return line
    .slice(3)
    .replace(/^"(.*)"$/, '$1')
    .split(' -> ')
    .at(-1)
}

function statusLabel(line: string, staged: boolean, unstaged: boolean): string {
  if (line.startsWith('??')) return 'untracked'
  if (line.includes('D')) return 'deleted'
  if (staged && !unstaged && line[0] === 'A') return 'added'
  return 'modified'
}

async function gitFileFromStatus(
  root: string,
  line: string,
): Promise<StudioGitFile | undefined> {
  const path = statusPath(line)
  if (!path) return undefined
  const untracked = line.startsWith('??')
  const staged = fileStaged(line)
  const unstaged = fileUnstaged(line)
  return {
    path,
    status: statusLabel(line, staged, unstaged),
    staged: staged && !unstaged,
    diff: await diffFor(root, path, unstaged ? false : staged, untracked),
  }
}

async function statusFiles(
  root: string,
  output: string,
): Promise<StudioGitFile[]> {
  const files: StudioGitFile[] = []
  for (const line of output.split('\n').filter(Boolean)) {
    const file = await gitFileFromStatus(root, line)
    if (file) files.push(file)
  }
  return files
}

async function workspaceStatus(root: string): Promise<StudioGitStatus> {
  const repo = git(root, ['rev-parse', '--is-inside-work-tree'])
  if (repo.exitCode !== 0) {
    return {
      files: [],
      pullRequestAvailable: false,
      pullRequestReason: 'This project is not a Git repository',
    }
  }
  const branch = git(root, ['branch', '--show-current']).stdout.trim()
  const porcelain = git(root, ['status', '--porcelain', '-uall'])
  assertGitSuccess(porcelain, 'read repository status')
  const files = await statusFiles(root, porcelain.stdout)
  const pullRequest = await pullRequestAvailability(root)
  return {
    ...(branch ? { branch } : {}),
    files,
    pullRequestAvailable: pullRequest.available,
    ...(pullRequest.reason ? { pullRequestReason: pullRequest.reason } : {}),
  }
}

async function stageWorkspaceFiles(
  root: string,
  paths: readonly string[],
): Promise<StudioGitStatus> {
  if (paths.length === 0) throw new Error('Select at least one path to stage')
  assertGitSuccess(git(root, ['add', '--', ...paths]), 'stage selected changes')
  return workspaceStatus(root)
}

async function commitWorkspaceFiles(
  root: string,
  input: Parameters<GitWorkspace['commit']>[0],
): Promise<StudioGitStatus> {
  if (!input.confirmed) {
    throw new Error('Confirm the commit before Studio writes to the repository')
  }
  const message = input.message.trim()
  if (!message) throw new Error('A commit message is required')
  const paths = [...(input.paths ?? [])].filter((path) => path.length > 0)
  if (paths.length === 0) throw new Error('Select at least one path to commit')
  assertGitSuccess(git(root, ['add', '--', ...paths]), 'stage selected changes')
  assertGitSuccess(
    git(root, ['commit', '-m', message, '--', ...paths]),
    'create the commit',
  )
  return workspaceStatus(root)
}

async function openPullRequest(root: string) {
  const availability = await pullRequestAvailability(root)
  if (!availability.available) {
    throw new Error(
      availability.reason ?? 'Pull request actions are unavailable',
    )
  }
  const result = run(root, ['gh', 'pr', 'create', '--web'])
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() || 'GitHub CLI could not open a pull request',
    )
  }
  const url = result.stdout.match(/https?:\/\/\S+/)?.[0]
  return {
    ...(url ? { url } : {}),
    message: 'Opened the GitHub pull request workflow',
  }
}

export function createGitWorkspace(root: string): GitWorkspace {
  return {
    status: () => workspaceStatus(root),
    async stage(paths) {
      return stageWorkspaceFiles(root, paths)
    },
    async commit(input) {
      return commitWorkspaceFiles(root, input)
    },
    async pullRequest() {
      return openPullRequest(root)
    },
  }
}
