import { createRsbuild, loadConfig, mergeRsbuildConfig } from '@rsbuild/core'
import type { StartApp, StartServerModule } from './start-app'

export async function createDevelopmentApp(cwd: string): Promise<StartApp> {
  const config = await loadConfig({
    command: 'dev',
    cwd,
    envMode: 'development',
  })
  const rsbuild = await createRsbuild({
    cwd,
    config: mergeRsbuildConfig(config.content, {
      mode: 'development',
      server: { host: '127.0.0.1', printUrls: false },
      dev: {
        assetPrefix: '/assets/',
        client: { host: '127.0.0.1', port: '<port>', protocol: 'ws' },
      },
      output: { sourceMap: { js: 'cheap-module-source-map' } },
    }),
  })
  const server = await rsbuild.createDevServer()
  try {
    await server.listen()
    const ssr = server.environments.ssr
    if (!ssr)
      throw new Error('Studio development SSR environment is unavailable')
    const origin = `http://127.0.0.1:${server.port}`
    return {
      hmrOrigin: origin.replace('http:', 'ws:'),
      async fetch(request, options) {
        const entry = await ssr.loadBundle<StartServerModule>('index')
        return entry.default.fetch(request, options)
      },
      serveAsset(request) {
        const url = new URL(request.url)
        return fetch(new URL(`${url.pathname}${url.search}`, origin), {
          method: request.method,
          signal: request.signal,
        })
      },
      stop() {
        void server.close()
      },
    }
  } catch (error) {
    await server.close()
    throw error
  }
}
