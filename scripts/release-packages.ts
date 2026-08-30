import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requiredValue } from './required-value'

type PackageManifest = {
  name?: string
  version?: string
  exports?: Record<string, string>
  bin?: Record<string, string>
  files?: string[]
  dependencies?: Record<string, string>
  publishConfig?: { access?: string }
}

type ReleasePackageDefinition = {
  directory: string
  name: string
  exports: Record<string, string>
}

export type ValidatedReleasePackage = {
  directory: string
  name: string
  dependencies: Record<string, string>
}

export type ReleasePackageValidation = {
  version: string
  packages: ValidatedReleasePackage[]
}

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const releasePackageDefinitions: ReleasePackageDefinition[] = [
  {
    directory: 'packages/configuration',
    name: '@pickle-spec/configuration',
    exports: { '.': './index.ts' },
  },
  {
    directory: 'packages/spec',
    name: '@pickle-spec/spec',
    exports: { '.': './index.ts' },
  },
  {
    directory: 'packages/runner',
    name: '@pickle-spec/runner',
    exports: {
      '.': './index.ts',
      './benchmarking': './benchmarking.ts',
      './testing': './testing.ts',
    },
  },
  {
    directory: 'packages/web',
    name: '@pickle-spec/web',
    exports: { '.': './index.ts' },
  },
  {
    directory: 'packages/mobile',
    name: '@pickle-spec/mobile',
    exports: { '.': './index.ts' },
  },
  {
    directory: 'packages/studio',
    name: '@pickle-spec/studio',
    exports: { '.': './index.ts' },
  },
  {
    directory: 'packages/cli',
    name: '@pickle-spec/cli',
    exports: { '.': './index.ts' },
  },
]

export const releasePackageDirectories = releasePackageDefinitions.map(
  ({ directory }) => directory,
)

const releasePackageNames = new Set(
  releasePackageDefinitions.map(({ name }) => name),
)

function assertRelease(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function sameEntries(
  actual: Record<string, string> | undefined,
  expected: Record<string, string>,
): boolean {
  if (!actual) return false
  const expectedEntries = Object.entries(expected)
  return (
    Object.keys(actual).length === expectedEntries.length &&
    expectedEntries.every(([key, value]) => actual[key] === value)
  )
}

async function readManifest(
  root: string,
  directory: string,
): Promise<PackageManifest> {
  return Bun.file(join(root, directory, 'package.json')).json()
}

async function assertExportTargets(
  root: string,
  definition: ReleasePackageDefinition,
): Promise<void> {
  for (const target of Object.values(definition.exports)) {
    const path = join(root, definition.directory, target)
    assertRelease(
      await Bun.file(path).exists(),
      `${definition.name} export target does not exist: ${target}`,
    )
  }
}

function runCommand(
  command: string[],
  cwd: string,
  errorContext: string,
): string {
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  assertRelease(
    result.exitCode === 0,
    `${errorContext}: ${result.stderr.toString().trim()}`,
  )
  return result.stdout.toString()
}

async function readPackedManifest(
  root: string,
  definition: ReleasePackageDefinition,
): Promise<{ manifest: PackageManifest; entries: string[] }> {
  const artifactDirectory = await mkdtemp(
    join(tmpdir(), 'pickle-package-artifact-'),
  )
  const archivePath = join(
    artifactDirectory,
    `${definition.directory.replace('/', '-')}.tgz`,
  )
  try {
    runCommand(
      ['bun', 'pm', 'pack', '--filename', archivePath, '--ignore-scripts'],
      join(root, definition.directory),
      `${definition.name} cannot be packed`,
    )
    const manifest = JSON.parse(
      runCommand(
        ['tar', '-xOf', archivePath, 'package/package.json'],
        root,
        `${definition.name} packed manifest cannot be read`,
      ),
    ) as PackageManifest
    const entries = runCommand(
      ['tar', '-tzf', archivePath],
      root,
      `${definition.name} package contents cannot be read`,
    )
      .trim()
      .split('\n')
      .filter(Boolean)
    return { manifest, entries }
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true })
  }
}

export function releaseVersionFromTag(tag: string): string {
  const version = tag.startsWith('v') ? tag.slice(1) : ''
  if (!versionPattern.test(version)) {
    throw new Error(
      'Release tag must use v<major>.<minor>.<patch> with an optional prerelease suffix',
    )
  }
  return version
}

export function releaseDistTagFromTag(tag: string): string {
  const version = releaseVersionFromTag(tag)
  const prereleaseSeparator = version.indexOf('-')
  if (prereleaseSeparator === -1) return 'latest'

  const channel = requiredValue(
    version.slice(prereleaseSeparator + 1).split('.')[0],
  ).toLowerCase()
  if (channel === 'latest') {
    throw new Error('Prerelease npm dist-tag cannot be latest')
  }
  if (!/^[a-z]/.test(channel)) {
    throw new Error('Prerelease npm dist-tag must start with a letter')
  }
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(channel)) {
    throw new Error(
      'Prerelease npm dist-tag must contain at most 32 letters, numbers, or hyphens',
    )
  }
  return channel
}

export async function setReleaseVersion(
  root: string,
  version: string,
): Promise<void> {
  assertRelease(
    versionPattern.test(version),
    `Invalid release version: ${version}`,
  )
  for (const { directory } of releasePackageDefinitions) {
    const path = join(root, directory, 'package.json')
    const manifest = await readManifest(root, directory)
    await Bun.write(
      path,
      `${JSON.stringify({ ...manifest, version }, null, 2)}\n`,
    )
  }
}

export async function prepareRelease(root: string, tag: string): Promise<void> {
  releaseDistTagFromTag(tag)
  const version = releaseVersionFromTag(tag)
  await setReleaseVersion(root, version)
  runCommand(
    ['bun', 'install', '--lockfile-only', '--ignore-scripts'],
    root,
    'Release lockfile refresh failed',
  )
}

type ReleaseDefinition = (typeof releasePackageDefinitions)[number]
type ReleaseManifest = Awaited<ReturnType<typeof readManifest>>
type PackedManifest = Awaited<ReturnType<typeof readPackedManifest>>

function validateSourceManifest(
  definition: ReleaseDefinition,
  manifest: ReleaseManifest,
  expectedVersion: string | undefined,
): string {
  assertRelease(
    manifest.name === definition.name,
    `${definition.directory} must publish as ${definition.name}`,
  )
  assertRelease(
    typeof manifest.version === 'string' &&
      versionPattern.test(manifest.version),
    `${definition.name} must have a valid release version`,
  )
  const version = expectedVersion ?? manifest.version
  assertRelease(
    manifest.version === version,
    `${definition.name} must use lockstep version ${version}`,
  )
  assertRelease(
    manifest.publishConfig?.access === 'public',
    `${definition.name} must publish with public access`,
  )
  assertRelease(
    sameEntries(manifest.exports, definition.exports),
    `${definition.name} exports must match its documented public entry points`,
  )
  return version
}

function validatePackedRelease(
  definition: ReleaseDefinition,
  manifest: ReleaseManifest,
  packed: PackedManifest,
  version: string,
): Record<string, string> {
  assertRelease(
    packed.manifest.version === version,
    `${definition.name} package artifact must use version ${version}`,
  )
  assertRelease(
    sameEntries(packed.manifest.exports, definition.exports),
    `${definition.name} package artifact exports do not match its public entry points`,
  )
  assertRelease(
    !packed.entries.some((entry) => /\.test\.[cm]?[jt]sx?$/.test(entry)),
    `${definition.name} package artifact must not include test sources`,
  )
  const internalNames = Object.keys(manifest.dependencies ?? {}).filter(
    (name) => releasePackageNames.has(name),
  )
  assertRelease(
    internalNames.every(
      (name) => packed.manifest.dependencies?.[name] === version,
    ),
    `${definition.name} package artifact must depend on release packages at ${version}`,
  )
  return Object.fromEntries(
    internalNames.map((name) => [
      name,
      packed.manifest.dependencies?.[name] ?? '',
    ]),
  )
}

async function validateReleasePackage(
  root: string,
  definition: ReleaseDefinition,
  expectedVersion: string | undefined,
): Promise<{ package: ValidatedReleasePackage; version: string }> {
  const manifest = await readManifest(root, definition.directory)
  const version = validateSourceManifest(definition, manifest, expectedVersion)
  await assertExportTargets(root, definition)
  const packed = await readPackedManifest(root, definition)
  const dependencies = validatePackedRelease(
    definition,
    manifest,
    packed,
    version,
  )
  return {
    version,
    package: {
      directory: definition.directory,
      name: definition.name,
      dependencies,
    },
  }
}

async function validateCliRelease(root: string): Promise<void> {
  const cli = await readManifest(root, 'packages/cli')
  assertRelease(
    cli.bin?.pickle === './src/cli.ts',
    '@pickle-spec/cli must install the pickle executable',
  )
  assertRelease(
    cli.dependencies?.['@pickle-spec/studio'] === 'workspace:*',
    '@pickle-spec/cli must install Studio for the pickle studio command',
  )
  const cliSource = await Bun.file(join(root, 'packages/cli/src/cli.ts')).text()
  assertRelease(
    cliSource.startsWith('#!/usr/bin/env bun'),
    'The pickle executable must declare the Bun runtime',
  )
  assertRelease(
    !(await Bun.file(join(root, 'packages/pickle-spec/package.json')).exists()),
    'The legacy monolithic package must not remain in the workspace',
  )
}

export async function validateReleasePackages(
  root: string,
): Promise<ReleasePackageValidation> {
  const packages: ValidatedReleasePackage[] = []
  let releaseVersion: string | undefined

  for (const definition of releasePackageDefinitions) {
    const validated = await validateReleasePackage(
      root,
      definition,
      releaseVersion,
    )
    releaseVersion = validated.version
    packages.push(validated.package)
  }
  await validateCliRelease(root)
  assertRelease(releaseVersion, 'The release must contain at least one package')

  return { version: releaseVersion, packages }
}

async function main(): Promise<void> {
  const root = join(import.meta.dir, '..')
  const [command, value] = process.argv.slice(2)
  if (command === 'dist-tag') {
    console.log(releaseDistTagFromTag(value ?? ''))
    return
  }
  if (command === 'prepare') {
    await prepareRelease(root, value ?? '')
    console.log(
      `Prepared all release packages at ${releaseVersionFromTag(value ?? '')}`,
    )
    return
  }
  if (command && command !== 'validate') {
    throw new Error(
      'Usage: bun scripts/release-packages.ts [validate|prepare <tag>|dist-tag <tag>]',
    )
  }
  const result = await validateReleasePackages(root)
  console.log(
    `Validated ${result.packages.length} packages at version ${result.version}`,
  )
}

if (import.meta.main) await main()
