import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
    maxWorkers: 1,
  },
})
