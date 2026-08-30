import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { resolveLocalProjectStorage } from '@pickle-spec/runner'
import { expect, test } from 'vitest'
import { startStudio } from '../../../src/server/server'
import { resolveStudioArtifactPath } from '../../../src/server/studio-artifact-path'

async function withProjectStorage(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const pickleHome = await mkdtemp(join(tmpdir(), 'pickle-artifact-home-'))
  const root = await mkdtemp(join(tmpdir(), 'pickle-artifact-root-'))
  const previous = process.env.PICKLE_HOME
  process.env.PICKLE_HOME = pickleHome
  try {
    await run(root)
  } finally {
    if (previous === undefined) delete process.env.PICKLE_HOME
    else process.env.PICKLE_HOME = previous
    await Promise.all([
      rm(pickleHome, { recursive: true, force: true }),
      rm(root, { recursive: true, force: true }),
    ])
  }
}

test('allows live web capture files under the project artifact directory', async () => {
  await withProjectStorage(async (root) => {
    const capture = join(
      resolveLocalProjectStorage(root).projectDirectory,
      'artifacts',
      'scenario-hash',
      'step-01-passed.png',
    )
    expect(resolveStudioArtifactPath(capture, root)).toEqual({
      kind: 'ready',
      path: resolve(capture),
    })
  })
})

test('rejects artifact paths outside the project storage sandbox', () => {
  expect(resolveStudioArtifactPath(null, process.cwd())).toEqual({
    kind: 'missing-query',
  })
  expect(resolveStudioArtifactPath('/tmp/secret.png', process.cwd())).toEqual({
    kind: 'forbidden',
  })
})

test('serves a live web screenshot that is not yet copied into the run directory', async () => {
  await withProjectStorage(async (root) => {
    const capture = join(
      resolveLocalProjectStorage(root).projectDirectory,
      'artifacts',
      'scenario-hash',
      'step-01-passed.png',
    )
    await mkdir(dirname(capture), { recursive: true })
    await Bun.write(capture, 'png-bytes')
    const server = await startStudio({
      project: {
        name: 'Artifacts',
        root,
        profiles: [],
        suites: [],
        specifications: [],
      },
      token: 'artifact-token',
    })
    try {
      const origin = new URL(server.url).origin
      const href = `${origin}/api/artifact?path=${encodeURIComponent(capture)}`
      const headers = { Authorization: 'Bearer artifact-token' }
      const preview = await fetch(href, { headers })
      const head = await fetch(href, { method: 'HEAD', headers })
      expect(preview.status).toBe(200)
      expect(await preview.text()).toBe('png-bytes')
      expect(head.status).toBe(200)
      const page = await fetch(`${origin}/?token=artifact-token`)
      expect(page.headers.get('content-security-policy')).toContain(
        "media-src 'self'",
      )
    } finally {
      server.stop()
    }
  })
})
