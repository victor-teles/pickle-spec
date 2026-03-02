import { defineConfig } from 'pickle-spec'

export default defineConfig({
  server: {
    command: 'bun run dev',
    port: 3000,
    url: 'http://localhost:3000',
  },
  browser: {
    env: 'LOCAL',
    modelName: 'claude-4-6-sonnet-latest',
    headless: true,
  },
})
