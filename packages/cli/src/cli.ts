#!/usr/bin/env bun

import type { CliActions } from './command-inputs'
import { createCliProgram } from './command-program'
import {
  checkProject,
  initializeProject,
  migrateProject,
} from './configuration/project'
import { runDoctorCommand } from './doctor/doctor'
import { runCacheCommand } from './execution-cache/cache'
import { runAppsCommand } from './mobile/apps'
import {
  compareRuns,
  exportRunCommand,
  importRunArchiveCommand,
} from './run/run-archive-commands'
import { runCommand } from './run/run-command'
import { runStudioCommand } from './studio/studio-command'
import { errorMessage } from './terminal/command-error'

const actions: CliActions = {
  run: runCommand,
  studio: runStudioCommand,
  async init() {
    await initializeProject()
    return 0
  },
  async check(input) {
    await checkProject({ ...input, report: console.log })
    return 0
  },
  async migrate(input) {
    await migrateProject({ ...input, report: console.log })
    return 0
  },
  compare: compareRuns,
  importArchive: importRunArchiveCommand,
  exportRun: exportRunCommand,
  apps: runAppsCommand,
  cache: runCacheCommand,
  doctor: runDoctorCommand,
}

try {
  process.exitCode = await createCliProgram(actions).parse(Bun.argv.slice(2))
} catch (error) {
  console.error(`ERROR ${errorMessage(error)}`)
  process.exitCode = 2
}
