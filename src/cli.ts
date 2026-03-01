#!/usr/bin/env bun

import { Command } from 'commander'
import { loadConfig } from './config'
import { parseFeatureFiles, filterPicklesByTag } from './parser'
import { runFeatures } from './runner'
import { reportSummary, reportError } from './reporter'

const program = new Command()

program
  .name('pickle-spec')
  .description('Run Gherkin .feature files with AI-powered browser automation')
  .version('0.1.0')

program
  .command('run')
  .description('Run feature files')
  .argument('[glob]', 'Glob pattern for feature files', 'features/**/*.feature')
  .option('-c, --config <path>', 'Path to pickle.config.ts')
  .option('--headed', 'Show browser window (disable headless)')
  .option('--verbose', 'Enable verbose output')
  .option('-t, --tag <tag>', 'Filter scenarios by tag')
  .action(async (glob: string, opts: {
    config?: string
    headed?: boolean
    verbose?: boolean
    tag?: string
  }) => {
    try {
      const config = await loadConfig(opts.config)

      if (opts.headed && config.stagehand) {
        config.stagehand.headless = false
      }

      const features = await parseFeatureFiles(glob)

      let featuresToRun = features
      if (opts.tag) {
        featuresToRun = features
          .map(f => ({ ...f, pickles: filterPicklesByTag(f.pickles, opts.tag!) }))
          .filter(f => f.pickles.length > 0)
        if (featuresToRun.length === 0) {
          reportError(`No scenarios found matching tag: ${opts.tag}`)
          process.exit(1)
        }
      }

      const result = await runFeatures(featuresToRun, config, {
        verbose: opts.verbose ?? false,
      })

      reportSummary(result)
      process.exit(result.failed > 0 ? 1 : 0)
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program
  .command('init')
  .description('Create a starter pickle.config.ts')
  .action(async () => {
    const configPath = 'pickle.config.ts'
    const file = Bun.file(configPath)

    if (await file.exists()) {
      reportError(`${configPath} already exists`)
      process.exit(1)
    }

    const configContent = `import { defineConfig } from 'pickle-spec'

export default defineConfig({
  server: {
    command: 'bun run dev',
    port: 3000,
    url: 'http://localhost:3000',
  },
  stagehand: {
    env: 'LOCAL',
    modelName: 'claude-3-5-sonnet-latest',
    headless: true,
  },
})
`

    await Bun.write(configPath, configContent)
    console.log(`Created ${configPath}`)
  })

program.parse()
