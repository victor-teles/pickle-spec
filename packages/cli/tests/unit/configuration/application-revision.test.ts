import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { resolveApplicationRevision } from '../../../src/configuration/application-revision'

test('resolves git:HEAD to the current project commit', () => {
  const projectRoot = resolve(import.meta.dir, '../../../../..')

  expect(resolveApplicationRevision('git:HEAD', projectRoot)).toMatch(
    /^[a-f0-9]{40}$/,
  )
})

test('preserves explicit application revisions and an omitted revision', () => {
  expect(resolveApplicationRevision('release-42', '/missing')).toBe(
    'release-42',
  )
  expect(resolveApplicationRevision(undefined, '/missing')).toBeUndefined()
})
