import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  prepareRelease,
  releaseDistTagFromTag,
  releasePackageDirectories,
  releaseVersionFromTag,
  setReleaseVersion,
  validateReleasePackages,
} from '../../../scripts/release-packages'

const repositoryRoot = resolve(import.meta.dir, '../../..')

type PublishWorkflowStep = {
  name?: string
  run?: string
  'continue-on-error'?: boolean
}

type PublishWorkflow = {
  jobs?: {
    publish?: {
      steps?: PublishWorkflowStep[]
    }
  }
}

async function readPublishSteps(): Promise<PublishWorkflowStep[] | undefined> {
  const workflow = Bun.YAML.parse(
    await Bun.file(
      join(repositoryRoot, '.github/workflows/publish.yml'),
    ).text(),
  ) as PublishWorkflow
  return workflow.jobs?.publish?.steps
}

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
  test('publishes every release package in dependency order', async () => {
    const steps = await readPublishSteps()
    const publishCommand = steps?.find(
      (step) => step.name === 'Publish compatible package set',
    )?.run
    const packageLoop = publishCommand?.match(/for package in ([^;]+); do/)

    expect(
      packageLoop?.[1]?.split(/\s+/).map((name) => `packages/${name}`),
    ).toEqual(releasePackageDirectories)
  })

  test('requires integration and end-to-end gates before release preparation and publication', async () => {
    const steps = await readPublishSteps()
    const preparationIndex =
      steps?.findIndex(
        (step) => step.name === 'Prepare lockstep version from release tag',
      ) ?? -1
    const publicationIndex =
      steps?.findIndex(
        (step) => step.name === 'Publish compatible package set',
      ) ?? -1
    const requiredCommands = ['bun run test:integration', 'bun run test:e2e']

    expect(preparationIndex).toBeGreaterThan(-1)
    expect(publicationIndex).toBeGreaterThan(preparationIndex)
    for (const command of requiredCommands) {
      const gateIndex = steps?.findIndex((step) => step.run === command) ?? -1

      expect(gateIndex).toBeGreaterThan(-1)
      expect(gateIndex).toBeLessThan(preparationIndex)
      expect(steps?.[gateIndex]?.['continue-on-error']).toBeUndefined()
    }
  })

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
