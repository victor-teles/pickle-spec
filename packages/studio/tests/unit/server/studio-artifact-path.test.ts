import { mkdir, mkdtemp, rm, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { resolveLocalProjectStorage } from '@pickle-spec/runner'
import { expect, test } from 'vitest'
import { startStudio } from '../../../src/server/server'
import {
  readStudioArtifact,
  resolveStudioArtifactPath,
} from '../../../src/server/studio-artifact-path'

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
    await mkdir(dirname(capture), { recursive: true })
    await Bun.write(capture, 'png-bytes')
    expect(resolveStudioArtifactPath(capture, root)).toEqual({
      kind: 'ready',
      path: resolve(capture),
    })
  })
})

test('rejects directory symlinks and treats dangling targets as missing', async () => {
  await withProjectStorage(async (root) => {
    const otherRoot = await mkdtemp(join(tmpdir(), 'pickle-artifact-other-'))
    const artifacts = join(
      resolveLocalProjectStorage(root).projectDirectory,
      'artifacts',
    )
    const external = join(otherRoot, 'outside.txt')
    const linkedDirectory = join(artifacts, 'linked-directory')
    const dangling = join(artifacts, 'dangling.txt')
    try {
      await mkdir(artifacts, { recursive: true })
      await Bun.write(external, 'synthetic-secret-canary')
      await symlink(otherRoot, linkedDirectory)
      await symlink(join(otherRoot, 'absent.txt'), dangling)

      expect(
        await readStudioArtifact(join(linkedDirectory, 'outside.txt'), root),
      ).toEqual({ kind: 'forbidden' })
      expect(await readStudioArtifact(dangling, root)).toEqual({
        kind: 'missing',
      })
    } finally {
      await rm(otherRoot, { recursive: true, force: true })
    }
  })
})

test('revalidates a previously authorized path before reading it', async () => {
  await withProjectStorage(async (root) => {
    const otherRoot = await mkdtemp(join(tmpdir(), 'pickle-artifact-other-'))
    const artifact = join(
      resolveLocalProjectStorage(root).projectDirectory,
      'artifacts',
      'replaceable.txt',
    )
    const external = join(otherRoot, 'outside.txt')
    try {
      await mkdir(dirname(artifact), { recursive: true })
      await Bun.write(artifact, 'safe')
      await Bun.write(external, 'synthetic-secret-canary')
      expect(resolveStudioArtifactPath(artifact, root).kind).toBe('ready')

      await unlink(artifact)
      await symlink(external, artifact)

      expect(await readStudioArtifact(artifact, root)).toEqual({
        kind: 'forbidden',
      })
    } finally {
      await rm(otherRoot, { recursive: true, force: true })
    }
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

test('rejects cross-project and symlink escapes from project storage', async () => {
  await withProjectStorage(async (root) => {
    const otherRoot = await mkdtemp(join(tmpdir(), 'pickle-artifact-other-'))
    const external = join(
      resolveLocalProjectStorage(otherRoot).projectDirectory,
      'artifacts',
      'secret.txt',
    )
    const linked = join(
      resolveLocalProjectStorage(root).projectDirectory,
      'artifacts',
      'linked-secret.txt',
    )
    try {
      await mkdir(dirname(external), { recursive: true })
      await Bun.write(external, 'synthetic-secret-canary')
      await mkdir(dirname(linked), { recursive: true })
      await symlink(external, linked)

      expect(resolveStudioArtifactPath(external, root)).toEqual({
        kind: 'forbidden',
      })
      expect(resolveStudioArtifactPath(linked, root)).toEqual({
        kind: 'forbidden',
      })
    } finally {
      await rm(otherRoot, { recursive: true, force: true })
    }
  })
})

test('serves a live web screenshot that is not yet copied into the run directory', async () => {
  await withProjectStorage(async (root) => {
    const otherRoot = await mkdtemp(join(tmpdir(), 'pickle-artifact-other-'))
    const capture = join(
      resolveLocalProjectStorage(root).projectDirectory,
      'artifacts',
      'scenario-hash',
      'step-01-passed.png',
    )
    await mkdir(dirname(capture), { recursive: true })
    await Bun.write(capture, 'png-bytes')
    const external = join(otherRoot, 'outside.txt')
    const linkedDirectory = join(dirname(capture), 'linked-directory')
    const dangling = join(dirname(capture), 'dangling.txt')
    await Bun.write(external, 'synthetic-secret-canary')
    await symlink(otherRoot, linkedDirectory)
    await symlink(join(otherRoot, 'absent.txt'), dangling)
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
      const escaped = await fetch(
        `${origin}/api/artifact?path=${encodeURIComponent(join(linkedDirectory, 'outside.txt'))}`,
        { headers },
      )
      const missing = await fetch(
        `${origin}/api/artifact?path=${encodeURIComponent(dangling)}`,
        { headers },
      )
      expect(escaped.status).toBe(403)
      expect(missing.status).toBe(404)
      const page = await fetch(`${origin}/?token=artifact-token`)
      expect(page.headers.get('content-security-policy')).toContain(
        "media-src 'self'",
      )
    } finally {
      server.stop()
      await rm(otherRoot, { recursive: true, force: true })
    }
  })
})
