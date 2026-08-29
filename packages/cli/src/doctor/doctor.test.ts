import { expect, test } from 'vitest'
import type { PickleConfig } from '../configuration/config'
import {
  formatDoctorReport,
  parseDoctorArguments,
  runDoctorCommand,
} from './doctor'

const customConfig: PickleConfig = {
  schemaVersion: 1,
  executionTargetProfiles: {
    custom: { adapter: 'company-device-lab' },
  },
}

const silentProgress = {
  start() {},
  update() {},
  stop() {},
}

test('parses only Doctor project options', () => {
  expect(
    parseDoctorArguments([
      'doctor',
      '--config',
      'custom.jsonc',
      '--extensions',
      'extensions.ts',
    ]),
  ).toEqual({
    configPath: 'custom.jsonc',
    extensionsPath: 'extensions.ts',
    verbose: false,
  })
  expect(parseDoctorArguments(['doctor', '--verbose'])).toEqual({
    verbose: true,
  })
  expect(() => parseDoctorArguments(['doctor', '--profile', 'chrome'])).toThrow(
    'Usage: pickle doctor [--config <path>] [--extensions <path>] [--verbose]',
  )
})

test('validates statically before diagnosing and reports unchecked custom adapters', async () => {
  const calls: string[] = []
  const output: string[] = []
  const exitCode = await runDoctorCommand(['doctor'], {
    cwd: '/project',
    async check() {
      calls.push('check')
    },
    async load() {
      calls.push('load')
      return customConfig
    },
    async diagnose() {
      calls.push('diagnose')
      return {
        ready: true,
        diagnostics: [],
        uncheckedProfileIds: ['custom'],
      }
    },
    color: false,
    progress: {
      start() {
        calls.push('progress:start')
      },
      update() {
        calls.push('progress:update')
      },
      stop() {
        calls.push('progress:stop')
      },
    },
    report(message) {
      output.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(calls).toEqual([
    'progress:start',
    'check',
    'load',
    'progress:update',
    'diagnose',
    'progress:stop',
  ])
  expect(output).toEqual([
    '1/1 check passed. No issues detected.',
    '1 automatic check skipped because no probe is available.',
    'Use the --verbose flag to see details about passed checks.',
    '',
    '○ Profile "custom"',
    '  Automatic environment checks are not available for this profile.',
  ])
})

test('renders remediation and returns 2 for blocked environments', async () => {
  const report = {
    ready: false,
    diagnostics: [
      {
        profileIds: ['android'],
        diagnostic: {
          id: 'mobile.android-emulator',
          kind: 'blocked' as const,
          message: 'Android Emulator is not ready',
          remediation: [{ summary: 'Boot an Android Emulator' }] as const,
        },
      },
    ],
    uncheckedProfileIds: [],
  }
  const output: string[] = []
  const exitCode = await runDoctorCommand(['doctor'], {
    cwd: '/project',
    async check() {},
    async load() {
      return customConfig
    },
    async diagnose() {
      return report
    },
    color: false,
    progress: silentProgress,
    report(message) {
      output.push(message)
    },
  })

  expect(exitCode).toBe(2)
  expect(output).toEqual(formatDoctorReport(report))
  expect(output).toContain('Advice:')
  expect(output).toContain('  Boot an Android Emulator')
})

test('shows passed checks and semantic colors only when requested', () => {
  const report = {
    ready: true,
    diagnostics: [
      {
        profileIds: ['web'],
        diagnostic: {
          id: 'web.local-browser',
          kind: 'ready' as const,
          message: 'Local Chrome launched and closed successfully',
        },
      },
    ],
    uncheckedProfileIds: [],
  }

  expect(formatDoctorReport(report)).toEqual([
    '2/2 checks passed. No issues detected.',
    'Use the --verbose flag to see details about passed checks.',
  ])
  const verbose = formatDoctorReport(report, { color: true, verbose: true })
  expect(verbose.join('\n')).toContain('\u001b[32m✔\u001b[39m Local browser')
  expect(verbose.join('\n')).toContain('[profile: web]')
  expect(verbose.join('\n')).not.toContain('--verbose')
})

test('stops terminal progress when project validation fails', async () => {
  let stopped = false

  await expect(
    runDoctorCommand(['doctor'], {
      cwd: '/project',
      async check() {
        throw new Error('Invalid project')
      },
      async load() {
        return customConfig
      },
      async diagnose() {
        throw new Error('Environment checks must not run')
      },
      color: false,
      progress: {
        start() {},
        update() {},
        stop() {
          stopped = true
        },
      },
      report() {},
    }),
  ).rejects.toThrow('Invalid project')
  expect(stopped).toBe(true)
})
