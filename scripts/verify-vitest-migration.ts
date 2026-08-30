import { basename, join, resolve } from 'node:path'

type JsonObject = Record<string, unknown>
type DependencyMap = Record<string, string>
type DependencyField = 'dependencies' | 'devDependencies' | 'peerDependencies'
type Violation = {
  file: string
  detail: string
}

const repositoryRoot = resolve(import.meta.dir, '..')
const ignoredDirectories = new Set(['.git', '.turbo', 'dist', 'node_modules'])
const sourceFilePattern = /\.[cm]?[jt]sx?$/
const legacyImport = ['bun', 'test'].join(':')
const legacyCommand = ['bun', 'test'].join(' ')
const expectedCatalog: DependencyMap = {
  vitest: '4.1.11',
  'vitest-mock-extended': '5.1.1',
}
const expectedRootDevDependencies = ['vitest']
const expectedPackageConfig = '../../vitest.package.config.ts'
const expectedCliConfig = 'vitest.config.ts'

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringMap(value: unknown): DependencyMap {
  if (!isObject(value)) return {}

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )
  return Object.fromEntries(entries)
}

function dependency(
  manifest: JsonObject,
  field: DependencyField,
  name: string,
): string | undefined {
  return stringMap(manifest[field])[name]
}

function checkCatalog(manifest: JsonObject): Violation[] {
  const workspace = manifest.workspaces
  const catalog = isObject(workspace) ? stringMap(workspace.catalog) : {}

  return Object.entries(expectedCatalog).flatMap(([name, version]) =>
    catalog[name] === version
      ? []
      : [
          {
            file: 'package.json',
            detail: `${name} must be pinned to ${version} in the workspace catalog`,
          },
        ],
  )
}

function checkRootDependencies(manifest: JsonObject): Violation[] {
  const devDependencies = stringMap(manifest.devDependencies)
  return expectedRootDevDependencies.flatMap((name) =>
    devDependencies[name] === 'catalog:'
      ? []
      : [
          {
            file: 'package.json',
            detail: `${name} must be installed from the workspace catalog`,
          },
        ],
  )
}

function checkRunnerTestingDependency(manifest: JsonObject): Violation[] {
  const peer = dependency(manifest, 'peerDependencies', 'vitest')
  const dev = dependency(manifest, 'devDependencies', 'vitest')
  const violations: Violation[] = []

  if (peer !== '^4.1.11') {
    violations.push({
      file: 'packages/runner/package.json',
      detail:
        '@pickle-spec/runner/testing must publish Vitest as a peer dependency',
    })
  }
  if (dev !== 'catalog:') {
    violations.push({
      file: 'packages/runner/package.json',
      detail:
        '@pickle-spec/runner must install Vitest locally for its own tests',
    })
  }

  return violations
}

function checkPackageScripts(file: string, manifest: JsonObject): Violation[] {
  const scripts = stringMap(manifest.scripts)
  const violations = Object.entries(scripts).flatMap(([name, script]) =>
    script.includes(legacyCommand)
      ? [
          {
            file,
            detail: `${name} still calls the Bun test runner`,
          },
        ]
      : [],
  )

  if (file === 'packages/cli/package.json') {
    return scripts['test:unit']?.includes(expectedCliConfig)
      ? violations
      : [
          ...violations,
          {
            file,
            detail:
              'test:unit must keep the dedicated CLI Vitest config for isolated PICKLE_HOME setup',
          },
        ]
  }

  if (!file.startsWith('packages/')) return violations

  const packageTestScript = scripts.test?.includes('test:unit')
    ? scripts['test:unit']
    : scripts.test
  return packageTestScript?.includes(expectedPackageConfig)
    ? violations
    : [
        ...violations,
        {
          file,
          detail: `test must use ${expectedPackageConfig} so package suites stay serialized under Vitest`,
        },
      ]
}

function shouldInspect(file: string): boolean {
  const parts = file.split('/')
  if (parts.some((part) => ignoredDirectories.has(part))) return false
  return basename(file) === 'package.json' || sourceFilePattern.test(file)
}

async function readJsonObject(file: string): Promise<JsonObject> {
  const source = await Bun.file(join(repositoryRoot, file)).text()
  const parsed: unknown = JSON.parse(source)
  return isObject(parsed) ? parsed : {}
}

async function checkFile(file: string): Promise<Violation[]> {
  const path = join(repositoryRoot, file)
  const source = await Bun.file(path).text()
  const violations: Violation[] = []

  if (sourceFilePattern.test(file) && source.includes(legacyImport)) {
    violations.push({
      file,
      detail: 'source still imports the Bun test runner',
    })
  }
  if (basename(file) !== 'package.json') return violations

  const manifest = await readJsonObject(file)
  violations.push(...checkPackageScripts(file, manifest))

  if (file === 'package.json') {
    violations.push(...checkCatalog(manifest))
    violations.push(...checkRootDependencies(manifest))
  }
  if (file === 'packages/runner/package.json') {
    violations.push(...checkRunnerTestingDependency(manifest))
  }

  return violations
}

async function main(): Promise<void> {
  const violations: Violation[] = []

  for await (const file of new Bun.Glob('**/*').scan({
    cwd: repositoryRoot,
    onlyFiles: true,
  })) {
    if (!shouldInspect(file)) continue
    violations.push(...(await checkFile(file)))
  }

  if (violations.length === 0) return

  for (const violation of violations) {
    console.error(`${violation.file}: ${violation.detail}`)
  }
  process.exitCode = 1
}

await main()
