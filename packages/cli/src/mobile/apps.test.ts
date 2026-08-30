import { expect, test } from 'vitest'
import { runAppsCommand } from './apps'

test('shows progress while listing apps and stops before printing results', async () => {
  const calls: string[] = []

  const exitCode = await runAppsCommand(
    { platform: 'ios', all: true },
    {
      async list(input) {
        calls.push(`list:${input.platform}:${input.scope}`)
        return ['com.example.notes']
      },
      progress: {
        start(label) {
          calls.push(`start:${label}`)
        },
        stop() {
          calls.push('stop')
        },
      },
      report(applicationId) {
        calls.push(`report:${applicationId}`)
      },
    },
  )

  expect(exitCode).toBe(0)
  expect(calls).toEqual([
    'start:Listing iOS apps',
    'list:ios:all',
    'stop',
    'report:com.example.notes',
  ])
})

test('stops progress when app discovery fails', async () => {
  const calls: string[] = []

  await expect(
    runAppsCommand(
      { platform: 'android', all: false },
      {
        async list() {
          calls.push('list')
          throw new Error('ADB unavailable')
        },
        progress: {
          start(label) {
            calls.push(`start:${label}`)
          },
          stop() {
            calls.push('stop')
          },
        },
        report() {},
      },
    ),
  ).rejects.toThrow('ADB unavailable')

  expect(calls).toEqual(['start:Listing Android apps', 'list', 'stop'])
})
