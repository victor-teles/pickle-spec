import { mkdir, readdir, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  openLocalExecutionCache,
  resolveLocalProjectStorage,
} from '../../../../index'
import { key, serialized, tempRoot, writeMetadata } from './fixtures'

describe('local Execution cache', () => {
  test('persists multiple revisions outside the canonical checkout', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    const linkedRoot = join(await tempRoot('pickle-link'), 'project')
    await symlink(projectRoot, linkedRoot)

    const original = await openLocalExecutionCache({ projectRoot, cacheRoot })
    const linked = await openLocalExecutionCache({
      projectRoot: linkedRoot,
      cacheRoot,
    })

    expect(original.projectKey).toMatch(/^[a-f0-9]{64}$/)
    expect(linked.projectKey).toBe(original.projectKey)
    expect(await realpath(linkedRoot)).toBe(await realpath(projectRoot))

    const revisionOne = serialized(original.projectKey, 'scenario-v1')
    const revisionTwo = serialized(original.projectKey, 'scenario-v2')
    expect(await original.write(revisionOne, writeMetadata)).toEqual({
      stored: true,
      evictedEntries: 0,
    })
    expect(await original.write(revisionTwo, writeMetadata)).toEqual({
      stored: true,
      evictedEntries: 0,
    })

    const reopened = await openLocalExecutionCache({ projectRoot, cacheRoot })
    expect(await reopened.read(revisionOne.key)).toBe(revisionOne.source)
    expect(await reopened.read(revisionTwo.key)).toBe(revisionTwo.source)
    expect(await Bun.file(join(projectRoot, '.pickle')).exists()).toBe(false)
  })

  test('isolates entries between checkouts', async () => {
    const firstProject = await tempRoot('pickle-project-one')
    const secondProject = await tempRoot('pickle-project-two')
    const cacheRoot = await tempRoot('pickle-cache')
    await mkdir(join(firstProject, 'features'))
    await mkdir(join(secondProject, 'features'))

    const first = await openLocalExecutionCache({
      projectRoot: firstProject,
      cacheRoot,
    })
    const second = await openLocalExecutionCache({
      projectRoot: secondProject,
      cacheRoot,
    })
    const entry = serialized(first.projectKey, 'scenario-v1')
    await first.write(entry, writeMetadata)

    expect(second.projectKey).not.toBe(first.projectKey)
    expect(await second.read(key(second.projectKey, 'scenario-v1'))).toBe(
      undefined,
    )
    expect(await first.read(entry.key)).toBe(entry.source)
    expect(
      (await readdir(cacheRoot, { withFileTypes: true })).filter((item) =>
        item.isDirectory(),
      ),
    ).toEqual([])
    expect(
      await Bun.file(join(cacheRoot, 'execution-cache.sqlite')).exists(),
    ).toBe(true)
  })

  test('shares one project identity and storage directory across Git worktrees', async () => {
    const repository = await tempRoot('pickle-repository')
    const worktree = await tempRoot('pickle-worktree')
    const commonGitDirectory = join(repository, '.git')
    const worktreeGitDirectory = join(
      commonGitDirectory,
      'worktrees',
      'feature',
    )
    await mkdir(worktreeGitDirectory, { recursive: true })
    await Bun.write(join(worktreeGitDirectory, 'commondir'), '../..\n')
    await Bun.write(join(worktree, '.git'), `gitdir: ${worktreeGitDirectory}\n`)

    const repositoryStorage = resolveLocalProjectStorage(repository)
    const worktreeStorage = resolveLocalProjectStorage(worktree)

    expect(worktreeStorage.projectKey).toBe(repositoryStorage.projectKey)
    expect(worktreeStorage.projectDirectory).toBe(
      repositoryStorage.projectDirectory,
    )
  })
})
