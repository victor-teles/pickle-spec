import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { validateReleasePackages } from './release-packages'

const repositoryRoot = resolve(import.meta.dir, '..')

function assertAcceptance(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message)
}

function runCommand(command: string[], cwd: string, context: string): string {
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  assertAcceptance(
    result.exitCode === 0,
    `${context}: ${result.stderr.toString().trim()}`,
  )
  return result.stdout.toString()
}

async function packReleaseSet(root: string, artifactRoot: string) {
  const release = await validateReleasePackages(root)
  const artifacts = release.packages.map(({ directory, name }) => ({
    name,
    path: join(artifactRoot, `${basename(directory)}.tgz`),
  }))

  for (const [index, { directory, name }] of release.packages.entries()) {
    const artifact = artifacts[index]
    assertAcceptance(
      artifact !== undefined,
      `Missing artifact path for ${name}`,
    )
    runCommand(
      ['bun', 'pm', 'pack', '--filename', artifact.path],
      join(root, directory),
      `${name} cannot be packed for installation`,
    )
  }
  return { artifacts, version: release.version }
}

async function installReleaseSet(
  projectRoot: string,
  artifacts: Awaited<ReturnType<typeof packReleaseSet>>['artifacts'],
): Promise<void> {
  const dependencies = Object.fromEntries(
    artifacts.map(({ name, path }) => [name, `file:${path}`]),
  )
  await Bun.write(
    join(projectRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'pickle-release-install-acceptance',
        private: true,
        dependencies,
        // Prepublication installs need overrides because packed internal
        // dependencies correctly refer to their final lockstep version.
        overrides: dependencies,
      },
      null,
      2,
    )}\n`,
  )
  runCommand(
    ['bun', 'install', '--ignore-scripts'],
    projectRoot,
    'Packed release set cannot be installed',
  )
}

async function verifyPackageImports(projectRoot: string): Promise<void> {
  const importPath = join(projectRoot, 'imports.ts')
  await Bun.write(
    importPath,
    `await Promise.all([
  import('@pickle-spec/configuration'),
  import('@pickle-spec/spec'),
  import('@pickle-spec/spec/schemas'),
  import('@pickle-spec/runner'),
  import('@pickle-spec/runner/benchmarking'),
  import('@pickle-spec/runner/schemas'),
  import('@pickle-spec/runner/testing'),
  import('@pickle-spec/web'),
  import('@pickle-spec/mobile'),
  import('@pickle-spec/studio'),
  import('@pickle-spec/cli'),
])
`,
  )
  runCommand(['bun', importPath], projectRoot, 'Packed package import failed')
}

function emptyRunArchive(id: string) {
  const startedAt = '2026-09-14T12:00:00.000Z'
  return {
    schemaVersion: 2,
    kind: 'run-archive',
    manifest: {
      schemaVersion: 2,
      id,
      startedAt,
      finishedAt: '2026-09-14T12:00:01.000Z',
      state: 'passed',
      results: [],
    },
    events: [
      {
        schemaVersion: 2,
        sequence: 1,
        occurredAt: startedAt,
        type: 'run-started',
        run: { id, startedAt },
      },
    ],
    artifacts: [],
  }
}

async function verifyArchiveHandoff(
  projectRoot: string,
  pickleExecutable: string,
): Promise<void> {
  const runId = 'run-release-install-acceptance'
  const incoming = join(projectRoot, 'incoming.archive.json')
  const outgoing = join(projectRoot, 'outgoing.archive.json')
  await Bun.write(incoming, `${JSON.stringify(emptyRunArchive(runId))}\n`)

  runCommand(
    [pickleExecutable, 'import', incoming],
    projectRoot,
    'Packed CLI cannot import a previous-schema archive',
  )
  runCommand(
    [pickleExecutable, 'export', runId, '--output', `archive=${outgoing}`],
    projectRoot,
    'Packed CLI cannot export an imported run',
  )

  const receivingRoot = join(projectRoot, 'receiving-project')
  await mkdir(receivingRoot)
  const output = runCommand(
    [pickleExecutable, 'import', outgoing],
    receivingRoot,
    'Packed CLI cannot hand an archive to an isolated project',
  )
  assertAcceptance(
    output.includes(`"id":"${runId}"`),
    'Archive handoff did not preserve the run identifier',
  )
}

async function studioUrl(stdout: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let output = ''
  for await (const chunk of stdout) {
    output += decoder.decode(chunk, { stream: true })
    const match = output.match(/(?:^|\n)Studio (http:\/\/[^\s]+)/)
    if (match?.[1]) return match[1]
  }
  throw new Error(`Packed Studio exited before startup: ${output.trim()}`)
}

async function verifyBuiltStudio(
  projectRoot: string,
  pickleExecutable: string,
): Promise<void> {
  await Bun.write(
    join(projectRoot, 'pickle.config.jsonc'),
    `${JSON.stringify({ schemaVersion: 1 }, null, 2)}\n`,
  )
  const studio = Bun.spawn({
    cmd: [pickleExecutable, 'studio', '--no-open', '--port', '0'],
    cwd: projectRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Packed Studio did not start within 30 seconds'))
      }, 30_000)
    })
    const url = await Promise.race([studioUrl(studio.stdout), timeout])
    const response = await fetch(url)
    const html = await response.text()
    assertAcceptance(
      response.ok,
      `Packed Studio returned HTTP ${response.status}`,
    )
    assertAcceptance(
      /<html[\s>]/i.test(html),
      'Packed Studio did not return its built application',
    )
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    studio.kill('SIGINT')
    await studio.exited
  }
}

async function acceptPackedRelease(root = repositoryRoot): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'pickle-release-install-'))
  try {
    const artifactRoot = join(temporaryRoot, 'artifacts')
    const projectRoot = join(temporaryRoot, 'project')
    await mkdir(artifactRoot)
    await mkdir(projectRoot)
    const { artifacts, version } = await packReleaseSet(root, artifactRoot)
    await installReleaseSet(projectRoot, artifacts)

    const pickleExecutable = join(projectRoot, 'node_modules/.bin/pickle')
    const installedVersion = runCommand(
      [pickleExecutable, '--version'],
      projectRoot,
      'Packed CLI cannot run',
    ).trim()
    assertAcceptance(
      installedVersion === version,
      `Packed CLI reported ${installedVersion}; expected ${version}`,
    )
    await verifyPackageImports(projectRoot)
    await verifyArchiveHandoff(projectRoot, pickleExecutable)
    await verifyBuiltStudio(projectRoot, pickleExecutable)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  await acceptPackedRelease()
  console.log(
    'Accepted packed release installation, CLI, Studio, and archive handoff',
  )
}
