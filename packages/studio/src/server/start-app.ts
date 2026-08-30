import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { StudioRequestContext } from '../server-context'

const studioPackageRoot = join(import.meta.dir, '../..')
const startServerEntryPath = join(studioPackageRoot, 'dist/server/index.js')

export const startClientDirectory = join(studioPackageRoot, 'dist/client')

export type StartServerEntry = {
  fetch(
    request: Request,
    options: { context: StudioRequestContext },
  ): Response | Promise<Response>
}

let startBuild: Promise<StartServerEntry> | undefined

async function loadStartServerEntry(): Promise<StartServerEntry> {
  if (!(await Bun.file(startServerEntryPath).exists())) {
    const { createRsbuild, loadConfig } = await import('@rsbuild/core')
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const config = await loadConfig({
        command: 'build',
        cwd: studioPackageRoot,
        envMode: 'production',
      })
      const rsbuild = await createRsbuild({
        config,
        cwd: studioPackageRoot,
      })
      await rsbuild.build()
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
    }
  }
  const entryUrl = pathToFileURL(startServerEntryPath).href
  const module = (await import(entryUrl)) as { default: StartServerEntry }
  return module.default
}

export function buildStartApp(): Promise<StartServerEntry> {
  startBuild ??= loadStartServerEntry().catch((error: unknown) => {
    startBuild = undefined
    throw error
  })
  return startBuild
}
