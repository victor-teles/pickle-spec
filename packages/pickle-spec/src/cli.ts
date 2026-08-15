#!/usr/bin/env bun

import { resolve } from 'path'
import { createProgram } from './cli-app'

const pkg = await Bun.file(resolve(import.meta.dir, '../package.json')).json()

await createProgram(pkg.version).parseAsync(process.argv)
