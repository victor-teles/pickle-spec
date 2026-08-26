import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  prepareRelease,
  releaseDistTagFromTag,
  releasePackageDirectories,
  releaseVersionFromTag,
  setReleaseVersion,
  validateReleasePackages,
} from './release-packages'

const repositoryRoot = resolve(import.meta.dir, '..')

const packageFixtures = [
  ['configuration', '@pickle-spec/configuration', { '.': './index.ts' }, {}],
  [
    'spec',
    '@pickle-spec/spec',
    { '.': './index.ts' },
    { '@pickle-spec/configuration': 'workspace:*' },
  ],
  [
    'runner',
    '@pickle-spec/runner',
    {
      '.': './index.ts',
      './benchmarking': './benchmarking.ts',
      './testing': './testing.ts',
    },
    {
      '@pickle-spec/configuration': 'workspace:*',
      '@pickle-spec/spec': 'workspace:*',
    },
  ],
  [
    'web',
    '@pickle-spec/web',
    { '.': './index.ts' },
    {
      '@pickle-spec/configuration': 'workspace:*',
      '@pickle-spec/runner': 'workspace:*',
      '@pickle-spec/spec': 'workspace:*',
    },
  ],
  [
    'mobile',
    '@pickle-spec/mobile',
    { '.': './index.ts' },
    { '@pickle-spec/runner': 'workspace:*' },
  ],
  [
    'studio',
    '@pickle-spec/studio',
    { '.': './index.ts' },
    {
      '@pickle-spec/runner': 'workspace:*',
      '@pickle-spec/spec': 'workspace:*',
    },
  ],
  [
    'cli',
    '@pickle-spec/cli',
    { '.': './index.ts' },
    {
      '@pickle-spec/configuration': 'workspace:*',
      '@pickle-spec/mobile': 'workspace:*',
      '@pickle-spec/runner': 'workspace:*',
      '@pickle-spec/spec': 'workspace:*',
      '@pickle-spec/studio': 'workspace:*',
      '@pickle-spec/web': 'workspace:*',
    },
  ],
] as const

async function createReleaseWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pickle-release-packages-'))
  await Bun.write(
    join(root, 'package.json'),
    `${JSON.stringify({ private: true, workspaces: ['packages/*'] }, null, 2)}\n`,
  )
  for (const [directory, name, exports, dependencies] of packageFixtures) {
    const packageRoot = join(root, 'packages', directory)
    await mkdir(join(packageRoot, 'src'), { recursive: true })
    const files = [
      ...new Set(
        Object.values(exports).map((target) => target.replace('./', '')),
      ),
      'src/**/*.ts',
      '!src/**/*.test.ts',
    ]
    await Bun.write(
      join(packageRoot, 'package.json'),
      `${JSON.stringify(
        {
          name,
          version: '1.0.2',
          type: 'module',
          exports,
          publishConfig: { access: 'public' },
          files,
          ...(directory === 'cli' ? { bin: { pickle: './src/cli.ts' } } : {}),
          dependencies,
        },
        null,
        2,
      )}\n`,
    )
    for (const target of Object.values(exports)) {
      await Bun.write(join(packageRoot, target), 'export {}\n')
    }
    if (directory === 'cli') {
      await Bun.write(join(packageRoot, 'src/cli.ts'), '#!/usr/bin/env bun\n')
    }
  }
  return root
}

describe('release package acceptance', () => {
  test('publishes one compatible package set with curated public entry points', async () => {
    const result = await validateReleasePackages(repositoryRoot)

    expect(result.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
    expect(result.packages.map((item) => item.name)).toEqual([
      '@pickle-spec/configuration',
      '@pickle-spec/spec',
      '@pickle-spec/runner',
      '@pickle-spec/web',
      '@pickle-spec/mobile',
      '@pickle-spec/studio',
      '@pickle-spec/cli',
    ])
  })

  test('derives a package version only from a version release tag', () => {
    expect(releaseVersionFromTag('v2.3.4')).toBe('2.3.4')
    expect(releaseVersionFromTag('v2.3.4-rc.1')).toBe('2.3.4-rc.1')
    expect(() => releaseVersionFromTag('release-2.3.4')).toThrow(
      'Release tag must use v<major>.<minor>.<patch>',
    )
  })

  test('uses latest only for stable releases and a safe prerelease channel otherwise', () => {
    expect(releaseDistTagFromTag('v2.3.4')).toBe('latest')
    expect(releaseDistTagFromTag('v2.3.4-rc.1')).toBe('rc')
    expect(releaseDistTagFromTag('v2.3.4-Canary.2')).toBe('canary')
    expect(() => releaseDistTagFromTag('v2.3.4-latest.1')).toThrow(
      'Prerelease npm dist-tag cannot be latest',
    )
    expect(() => releaseDistTagFromTag('v2.3.4-1')).toThrow(
      'Prerelease npm dist-tag must start with a letter',
    )
  })

  test('updates every release package without changing workspace dependencies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pickle-release-version-'))
    for (const directory of releasePackageDirectories) {
      await mkdir(join(root, directory), { recursive: true })
      await Bun.write(
        join(root, directory, 'package.json'),
        `${JSON.stringify(
          {
            name: `fixture-${directory}`,
            version: '1.0.2',
            dependencies: { '@pickle-spec/spec': 'workspace:*' },
          },
          null,
          2,
        )}\n`,
      )
    }

    await setReleaseVersion(root, '2.3.4')

    for (const directory of releasePackageDirectories) {
      const manifest = await Bun.file(
        join(root, directory, 'package.json'),
      ).json()
      expect(manifest.version).toBe('2.3.4')
      expect(manifest.dependencies).toEqual({
        '@pickle-spec/spec': 'workspace:*',
      })
    }
  })

  test('refreshes the lockfile so packed internal dependencies use the release version', async () => {
    const root = await createReleaseWorkspace()
    try {
      await prepareRelease(root, 'v9.8.7')

      const result = await validateReleasePackages(root)

      expect(result.version).toBe('9.8.7')
      expect(
        result.packages.find((item) => item.name === '@pickle-spec/cli')
          ?.dependencies,
      ).toEqual({
        '@pickle-spec/configuration': '9.8.7',
        '@pickle-spec/mobile': '9.8.7',
        '@pickle-spec/runner': '9.8.7',
        '@pickle-spec/spec': '9.8.7',
        '@pickle-spec/studio': '9.8.7',
        '@pickle-spec/web': '9.8.7',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
