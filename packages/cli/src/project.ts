import { relative, resolve } from 'node:path'
import { validateProjectRunConfiguration } from '@pickle-spec/runner'
import {
  formatMigrationPreview,
  parseSpecification,
  planSpecificationMigration,
  type SpecificationSourceFile,
  validateSpecificationMetadata,
} from '@pickle-spec/spec'
import { loadConfig, type PickleConfig, runConfigurationFrom } from './config'
import { validateExtensions } from './extension-validation'

const defaultConfigPath = 'pickle.config.jsonc'
const defaultExtensionsPath = 'pickle.extensions.ts'

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
  yes?: boolean
  report?: (message: string) => void
}

export async function initializeProject(
  options: ProjectCommandOptions = {},
): Promise<void> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const report = options.report ?? console.log
  for (const [path, contents] of [
    [defaultConfigPath, initialConfig],
    [defaultExtensionsPath, initialExtensions],
  ] as const) {
    const absolutePath = resolve(cwd, path)
    if (await Bun.file(absolutePath).exists()) {
      report(`Skipped ${path}: file already exists`)
      continue
    }
    await Bun.write(absolutePath, contents)
    report(`Created ${path}`)
  }
}

async function discoverSpecificationPaths(
  config: PickleConfig,
  cwd: string,
): Promise<string[]> {
  const patterns = config.specifications ?? 'features/**/*.feature'
  const specificationPaths = new Set<string>()
  for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
    let found = false
    for await (const path of new Bun.Glob(pattern).scan({
      cwd,
      onlyFiles: true,
    })) {
      found = true
      specificationPaths.add(resolve(cwd, path))
    }
    if (!found) {
      throw new Error(
        `Specification path ${JSON.stringify(pattern)} matches no files. Add a Specification or correct specifications in the configuration.`,
      )
    }
  }
  return [...specificationPaths].sort()
}

async function readSpecificationFiles(
  config: PickleConfig,
  cwd: string,
): Promise<SpecificationSourceFile[]> {
  const files: SpecificationSourceFile[] = []
  for (const path of await discoverSpecificationPaths(config, cwd)) {
    const uri = relative(cwd, path)
    const source = await Bun.file(path).text()
    try {
      parseSpecification({ source, uri, language: config.language })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Invalid Specification ${uri}: ${reason}. ` +
          'Correct the Specification and run pickle check again.',
      )
    }
    files.push({ uri, source })
  }
  return files
}

export async function migrateProject(
  options: ProjectCommandOptions = {},
): Promise<void> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const configPath = resolve(cwd, options.configPath ?? defaultConfigPath)
  const report = options.report ?? console.log
  if (!(await Bun.file(configPath).exists())) {
    throw new Error(
      `Configuration file not found: ${relative(cwd, configPath)}. Run pickle init or pass --config <path>.`,
    )
  }

  const previousCwd = process.cwd()
  try {
    process.chdir(cwd)
    const config = await loadConfig(configPath)
    const files = await readSpecificationFiles(config, cwd)
    const plan = planSpecificationMigration(files, config.language)
    report(formatMigrationPreview(plan))
    if (plan.changes.length === 0) return
    if (!options.yes) {
      if (!process.stdin.isTTY) {
        report(
          'No files were changed. Re-run pickle migrate --yes after reviewing the preview.',
        )
        return
      }
      if (!/^[yY]/.test((prompt('Apply these changes? [y/N]') ?? '').trim())) {
        report('No files were changed')
        return
      }
    }
    let updated = 0
    for (const file of plan.files) {
      if (file.source === file.nextSource) continue
      await Bun.write(resolve(cwd, file.uri), file.nextSource)
      updated++
    }
    report(`Updated ${updated} Specification file(s)`)
  } finally {
    process.chdir(previousCwd)
  }
}

export async function checkProject(
  options: ProjectCommandOptions = {},
): Promise<void> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const configPath = resolve(cwd, options.configPath ?? defaultConfigPath)
  const extensionsPath = resolve(
    cwd,
    options.extensionsPath ?? defaultExtensionsPath,
  )
  if (!(await Bun.file(configPath).exists())) {
    throw new Error(
      `Configuration file not found: ${relative(cwd, configPath)}. Run pickle init or pass --config <path>.`,
    )
  }
  if (!(await Bun.file(extensionsPath).exists())) {
    throw new Error(
      `Extensions file not found: ${relative(cwd, extensionsPath)}. Run pickle init or pass --extensions <path>.`,
    )
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
    validateSpecificationMetadata(
      await readSpecificationFiles(config, cwd),
      config.language,
    )
    options.report?.(
      `Project is valid (${relative(cwd, configPath)}, ${relative(cwd, extensionsPath)})`,
    )
  } finally {
    process.chdir(previousCwd)
  }
}
