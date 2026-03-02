import { defineConfig } from 'pickle-spec'

export default defineConfig({
  features: '**/*.feature',
  server: {
    url: "https://google.com",
  },
  browser: {
    env: 'LOCAL',
    modelName: 'openai/gpt-5.2',
    headless: false,
  },
})
