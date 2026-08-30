import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../vitest.package.config'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      globalSetup: ['./tests/support/test-environment.ts'],
      testTimeout: 30_000,
    },
  }),
)
