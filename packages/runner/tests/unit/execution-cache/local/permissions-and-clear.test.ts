import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { openLocalExecutionCache } from '../../../../index'
import { serialized, tempRoot, writeMetadata } from './fixtures'

describe('local Execution cache', () => {
  test('restricts local cache permissions and clears only the current checkout', async () => {
    const firstProject = await tempRoot('pickle-project-one')
    const secondProject = await tempRoot('pickle-project-two')
    const cacheRoot = await tempRoot('pickle-cache')
    const first = await openLocalExecutionCache({
      projectRoot: firstProject,
      cacheRoot,
    })
    const second = await openLocalExecutionCache({
      projectRoot: secondProject,
      cacheRoot,
    })
    const firstEntry = serialized(first.projectKey, 'scenario-v1')
    const secondEntry = serialized(second.projectKey, 'scenario-v1')
    await first.write(firstEntry, writeMetadata)
    await second.write(secondEntry, writeMetadata)
    expect((await first.coordination.acquire(firstEntry.key)).acquired).toBe(
      true,
    )

    await first.clear()

    expect(await first.inspect()).toEqual([])
    expect((await first.coordination.acquire(firstEntry.key)).acquired).toBe(
      true,
    )
    expect(await second.read(secondEntry.key)).toBe(secondEntry.source)
    if (process.platform !== 'win32') {
      expect((await stat(cacheRoot)).mode & 0o777).toBe(0o700)
      expect(
        (await stat(join(cacheRoot, 'execution-cache.sqlite'))).mode & 0o777,
      ).toBe(0o600)
    }
  })
})
