import { validateProjectRunConfiguration } from '@pickle-spec/runner'
import { parseSpecificationFile } from '@pickle-spec/spec'
import { relative, resolve } from 'node:path'
import { loadConfig, runConfigurationFrom, type PickleConfig } from './config'
import { validateExtensions } from './extension-validation'

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

interface ProjectCommandOptions {
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

async function validateSpecificationPaths(config: PickleConfig, cwd: string): Promise<void> {
  const patterns = config.specifications ?? 'features/**/*.feature'
  const specificationPaths = new Set<string>()
  for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
    let found = false
    for await (const path of new Bun.Glob(pattern).scan({ cwd, onlyFiles: true })) {
      found = true
      specificationPaths.add(resolve(cwd, path))
    }
    if (!found) {
      throw new Error(`Specification path ${JSON.stringify(pattern)} matches no files. Add a Specification or correct specifications in the configuration.`)
    }
  }
  for (const path of [...specificationPaths].sort()) {
    try {
      await parseSpecificationFile(path, config.language)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Invalid Specification ${relative(cwd, path)}: ${reason}. `
        + 'Correct the Specification and run pickle check again.',
      )
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
    const extensions = validateExtensions(extensionsPath)
    validateProjectRunConfiguration(runConfigurationFrom(config), {
      ...extensions,
      fallbackAdapterAvailable: Boolean(config.web),
    })
    await validateSpecificationPaths(config, cwd)
    options.report?.(`Project is valid (${relative(cwd, configPath)}, ${relative(cwd, extensionsPath)})`)
  } finally {
    process.chdir(previousCwd)
  }
}
