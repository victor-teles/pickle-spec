import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, type PickleConfig } from './config'

const CONFIG_PATH = 'pickle.config.jsonc'
const EXTENSIONS_PATH = 'pickle.extensions.ts'

const initialConfig = `{
  // Pickle Spec project configuration.
  "schemaVersion": 1,
  "specifications": "features/**/*.feature",
  "executionTargetProfile": { "id": "custom" }
}
`

const initialExtensions = `// Add execution-target integrations here. Importing this file must not start resources.
export default {
  adapter: {
    async openSession() {
      throw new Error('Configure an execution target in pickle.extensions.ts before running scenarios')
    },
  },
}
`

export interface ProjectCommandOptions {
  cwd?: string
  configPath?: string
  extensionsPath?: string
  report?: (message: string) => void
}

export async function initializeProject(options: ProjectCommandOptions = {}): Promise<void> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const report = options.report ?? console.log
  for (const [path, contents] of [[CONFIG_PATH, initialConfig], [EXTENSIONS_PATH, initialExtensions]] as const) {
    const absolutePath = resolve(cwd, path)
    if (await Bun.file(absolutePath).exists()) {
      report(`Skipped ${path}: file already exists`)
      continue
    }
    await Bun.write(absolutePath, contents)
    report(`Created ${path}`)
  }
}

async function importExtensions(path: string): Promise<Record<string, unknown>> {
  try {
    const module = await import(`${pathToFileURL(path).href}?check=${Date.now()}`)
    const extensions = module.default
    if (typeof extensions !== 'object' || extensions === null || Array.isArray(extensions)) {
      throw new Error('the default export must be an object')
    }
    return extensions as Record<string, unknown>
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot import ${relative(process.cwd(), path)}: ${reason}. Fix its imports and default export.`)
  }
}

async function validateSpecificationPaths(config: PickleConfig, cwd: string): Promise<void> {
  const patterns = config.specifications ?? 'features/**/*.feature'
  for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
    let found = false
    for await (const _ of new Bun.Glob(pattern).scan({ cwd, onlyFiles: true })) {
      found = true
      break
    }
    if (!found) {
      throw new Error(`Specification path ${JSON.stringify(pattern)} matches no files. Add a Specification or correct specifications in the configuration.`)
    }
  }
}

export async function checkProject(options: ProjectCommandOptions = {}): Promise<void> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const configPath = resolve(cwd, options.configPath ?? CONFIG_PATH)
  const extensionsPath = resolve(cwd, options.extensionsPath ?? EXTENSIONS_PATH)
  if (!(await Bun.file(configPath).exists())) {
    throw new Error(`Configuration file not found: ${relative(cwd, configPath)}. Run pickle init or pass --config <path>.`)
  }
  if (!(await Bun.file(extensionsPath).exists())) {
    throw new Error(`Extensions file not found: ${relative(cwd, extensionsPath)}. Run pickle init or pass --extensions <path>.`)
  }

  const previousCwd = process.cwd()
  try {
    process.chdir(cwd)
    const config = await loadConfig(configPath)
    const extensions = await importExtensions(extensionsPath)
    await validateSpecificationPaths(config, cwd)
    if (!config.web && !extensions.adapter) {
      throw new Error('No execution target is configured. Configure web.baseUrl or export an adapter from the extensions file.')
    }
    if (extensions.adapter !== undefined && (typeof extensions.adapter !== 'object' || extensions.adapter === null
      || typeof (extensions.adapter as { openSession?: unknown }).openSession !== 'function')) {
      throw new Error('extensions.adapter must provide openSession. Export a valid execution-target adapter.')
    }
    options.report?.(`Project is valid (${relative(cwd, configPath)}, ${relative(cwd, extensionsPath)})`)
  } finally {
    process.chdir(previousCwd)
  }
}
