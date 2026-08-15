#!/usr/bin/env bun

import type { ExecutionTargetAdapter, ExecutionTargetProfile } from '@pickle-spec/runner'
import { runScenario } from '@pickle-spec/runner'
import { parseSpecificationFile } from '@pickle-spec/spec'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface Extensions {
  adapter: ExecutionTargetAdapter
  executionTargetProfile: ExecutionTargetProfile
}

interface RunArguments {
  featurePath: string
  extensionsPath: string
}

function parseRunArguments(argv: string[]): RunArguments {
  if (argv[0] !== 'run' || !argv[1]) {
    throw new Error('Usage: pickle run <feature> [--extensions <path>]')
  }

  const extensionsFlag = argv.indexOf('--extensions')
  const extensionsPath = extensionsFlag === -1
    ? 'pickle.extensions.ts'
    : argv[extensionsFlag + 1]

  if (!extensionsPath) {
    throw new Error('--extensions requires a path')
  }

  return {
    featurePath: argv[1],
    extensionsPath,
  }
}

async function loadExtensions(filePath: string): Promise<Extensions> {
  const module = await import(pathToFileURL(filePath).href)
  const extensions = module.default as Partial<Extensions> | undefined

  if (!extensions?.adapter || !extensions.executionTargetProfile?.id) {
    throw new Error('Extensions must export an adapter and an executionTargetProfile')
  }

  return extensions as Extensions
}

async function main(argv: string[]): Promise<number> {
  const args = parseRunArguments(argv)
  const specification = await parseSpecificationFile(resolve(args.featurePath))
  const scenario = specification.scenarios[0]

  if (!scenario) {
    throw new Error(`Specification "${specification.name}" does not contain a Scenario`)
  }

  const extensions = await loadExtensions(resolve(args.extensionsPath))
  const run = await runScenario({
    specification,
    scenario,
    executionTargetProfile: extensions.executionTargetProfile,
    adapter: extensions.adapter,
    onEvent(event) {
      console.log(JSON.stringify({ kind: 'run-event', event }))
    },
  })

  console.log(JSON.stringify({ kind: 'test-result', result: run.result }))

  if (
    run.result.state === 'passed'
    || run.result.state === 'passed-with-adaptation'
    || run.result.state === 'skipped'
  ) return 0
  if (run.result.state === 'cancelled') return 130
  return 1
}

try {
  process.exitCode = await main(Bun.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 2
}
