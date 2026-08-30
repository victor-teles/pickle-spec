import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['tests/e2e/**/*.{test,spec}.{ts,tsx}'],
    maxWorkers: 1,
  },
})
