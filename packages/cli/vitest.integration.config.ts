import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../vitest.package.config'
import { cliIntegrationTests } from './vitest.test-groups'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      globalSetup: ['./test/test-environment.ts'],
      include: [...cliIntegrationTests],
      testTimeout: 30_000,
    },
  }),
)
