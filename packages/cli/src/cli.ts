#!/usr/bin/env node

import { loadEnvironment } from './configuration/environment'

loadEnvironment()
await import('./cli-main')
