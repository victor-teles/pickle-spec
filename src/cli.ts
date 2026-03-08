#!/usr/bin/env bun

import { resolve } from 'path'
import { Command } from 'commander'
import { loadConfig } from './config'
import { parseFeatureFiles, filterPicklesByTag } from './parser'
import { runFeatures, cancelRun } from './runner'
import { reportSummary, reportError, reportCancelled } from './reporter'
import { generateHtmlReport } from './html-report'
import pc from 'picocolors'

const pkg = await Bun.file(resolve(import.meta.dir, '../package.json')).json()

const program = new Command()

program
  .name('pickle-spec')
  .description('Run Gherkin .feature files with AI-powered browser automation')
  .version(pkg.version)

program
  .command('run')
  .description('Run feature files')
  .argument('[glob]', 'Glob pattern for feature files')
  .option('-c, --config <path>', 'Path to pickle.config.ts')
  .option('--headed', 'Show browser window (disable headless)')
  .option('--verbose', 'Enable verbose output')
  .option('-t, --tag <tag>', 'Filter scenarios by tag')
  .option('-l, --language <code>', 'Default Gherkin language (e.g., pt, ja, fr)')
  .option('--screenshot <mode>', 'Screenshot mode: off, on-failure, on-step')
  .option('-j, --concurrency <n>', 'Max parallel scenarios per feature', parseInt)
  .action(async (glob: string | undefined, opts: {
    config?: string
    headed?: boolean
    verbose?: boolean
    tag?: string
    language?: string
    screenshot?: string
    concurrency?: number
  }) => {
    const onSigint = () => {
      reportCancelled()
      cancelRun()
    }
    process.on('SIGINT', onSigint)

    try {
      const config = await loadConfig(opts.config)

      if (opts.headed && config.browser) {
        config.browser.headless = false
      }

      if (opts.screenshot) {
        config.screenshots = {
          ...config.screenshots,
          mode: opts.screenshot as 'off' | 'on-failure' | 'on-step',
        }
      }

      if (opts.concurrency) {
        config.concurrency = opts.concurrency
      }

      const language = opts.language ?? config.language
      const featurePatterns = glob ?? config.features ?? 'features/**/*.feature'
      const features = await parseFeatureFiles(featurePatterns, language)

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
        verbose: opts.verbose ?? config.verbose ?? false,
      })

      reportSummary(result)

      const reportPath = await generateHtmlReport(result)
      console.log(pc.dim(`  Report: ${reportPath}`))
      console.log('')

      Bun.spawn(['open', reportPath])
      process.exit(result.failed > 0 || result.cancelled ? 1 : 0)
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err))
      process.exit(1)
    } finally {
      process.off('SIGINT', onSigint)
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
    modelName: 'claude-4-6-sonnet-latest',
    headless: true,
  },
})
`

    await Bun.write(configPath, configContent)
    console.log(`Created ${configPath}`)
  })

program.parse()
