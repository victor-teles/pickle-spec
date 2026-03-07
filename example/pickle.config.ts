import { defineConfig } from 'pickle-spec'

export default defineConfig({
  features: '**/*.feature',
  verbose: true,
  concurrency: 1,
  server: {
    url: "https://google.com",
  },
  browser: {
    env: 'LOCAL',
    modelName: 'openai/gpt-5.2',
    headless: false,
  },
})
