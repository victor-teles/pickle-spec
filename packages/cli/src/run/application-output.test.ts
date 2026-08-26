import { expect, test } from 'bun:test'
import type { ExecutionTargetProfile } from '@pickle-spec/runner'
import type { PickleConfig } from '../configuration/config'
import { resolveApplicationOutput } from './application-output'

const profiles: ExecutionTargetProfile[] = [
  { id: 'desktop', adapter: 'web' },
  { id: 'phone', adapter: 'mobile' },
]

const config: PickleConfig = {
  schemaVersion: 1,
  server: { output: { stderr: true } },
  executionTargetProfiles: {
    desktop: {
      adapter: 'web',
      applicationOutput: { stdout: true, stderr: false },
    },
    phone: { adapter: 'mobile' },
  },
}

test('resolves managed output per selected profile with the run-wide fallback', () => {
  expect(resolveApplicationOutput(config, profiles)).toEqual({
    capture: { stdout: true, stderr: true },
    profiles: {
      stdout: ['desktop'],
      stderr: ['phone'],
    },
  })
})

test('an individual run can enable or disable each stream independently', () => {
  expect(
    resolveApplicationOutput(config, profiles, {
      stdout: false,
      stderr: true,
    }),
  ).toEqual({
    capture: { stdout: false, stderr: true },
    profiles: {
      stdout: [],
      stderr: ['desktop', 'phone'],
    },
  })
})

test('uses run-wide output for a legacy single profile', () => {
  expect(
    resolveApplicationOutput(
      { schemaVersion: 1, server: { output: { stdout: true } } },
      [{ id: 'web', adapter: 'web' }],
    ),
  ).toEqual({
    capture: { stdout: true, stderr: false },
    profiles: { stdout: ['web'], stderr: [] },
  })
})
