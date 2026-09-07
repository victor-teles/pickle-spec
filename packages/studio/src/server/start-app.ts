import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { staticMiddleware } from 'srvx/static'
import type { StudioRequestContext } from '../server-context'

const studioPackageRoot = join(import.meta.dir, '../..')
const startServerEntryPath = join(studioPackageRoot, 'dist/server/index.js')

const startClientDirectory = join(studioPackageRoot, 'dist/client')

export interface StartApp extends StartServerEntry {
  hmrOrigin?: string
  serveAsset(request: Request): Promise<Response>
  stop(): void
}

export type StartServerEntry = {
  fetch(
    request: Request,
    options: { context: StudioRequestContext },
  ): Response | Promise<Response>
}

export type StartServerModule = { default: StartServerEntry }

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
  const module = (await import(entryUrl)) as StartServerModule
  return module.default
}

export async function createStartApp(): Promise<StartApp> {
  if (process.env.PICKLE_STUDIO_DEV === '1') {
    const { createDevelopmentApp } = await import('./start-development')
    return createDevelopmentApp(studioPackageRoot)
  }
  startBuild ??= loadStartServerEntry().catch((cause: unknown) => {
    startBuild = undefined
    throw cause
  })
  const entry = await startBuild
  const assets = staticMiddleware({
    dir: startClientDirectory,
    immutable: true,
    maxAge: 31_536_000,
  })
  return {
    fetch: (request, options) => entry.fetch(request, options),
    serveAsset: async (request) =>
      assets(request, () => new Response('Not found', { status: 404 })),
    stop() {},
  }
}
