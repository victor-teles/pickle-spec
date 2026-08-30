import { describe, expect, test } from 'vitest'
import type {
  CliActions,
  RunCommandInput,
  StudioCommandInput,
} from './command-inputs'
import { createCliProgram } from './command-program'

const defaultActions: CliActions = {
  async run() {
    return 0
  },
  async studio() {
    return 0
  },
  async init() {
    return 0
  },
  async check() {
    return 0
  },
  async migrate() {
    return 0
  },
  async compare() {
    return 0
  },
  async importArchive() {
    return 0
  },
  async exportRun() {
    return 0
  },
  async apps() {
    return 0
  },
  async cache() {
    return 0
  },
  async doctor() {
    return 0
  },
}

function cliActions(overrides: Partial<CliActions> = {}): CliActions {
  return { ...defaultActions, ...overrides }
}

function program(actions: CliActions = cliActions()) {
  let output = ''
  return {
    cli: createCliProgram(actions, {
      write(message) {
        output += message
      },
    }),
    output: () => output,
  }
}

describe('Commander CLI boundary', () => {
  test('shows top-level help when no command is provided', async () => {
    const { cli, output } = program()

    expect(await cli.parse([])).toBe(0)
    expect(output()).toContain('Usage: pickle [options] [command]')
    expect(output()).toContain('Commands:')
  })

  test('shows command help and package version without running an action', async () => {
    const help = program()
    expect(await help.cli.parse(['--help'])).toBe(0)
    expect(help.output()).toContain('Usage: pickle [options] [command]')
    expect(help.output()).toContain('run [options] [specifications]')
    expect(help.output()).toContain('doctor')

    const version = program()
    expect(await version.cli.parse(['--version'])).toBe(0)
    expect(version.output()).toBe('1.0.2\n')
  })

  test('maps repeated and parsed run options into one typed input', async () => {
    let received: RunCommandInput | undefined
    const { cli } = program(
      cliActions({
        async run(input) {
          received = input
          return 0
        },
      }),
    )

    await cli.parse([
      'run',
      'features/**/*.feature',
      '--profile',
      'chromium',
      '--profile',
      'android',
      '--state',
      'active',
      '--state',
      'draft',
      '--shard',
      '2/3',
      '--concurrency',
      '4',
      '--output',
      'json=run.json',
      '--output',
      'junit=run.xml',
      '--application-output',
      'stdout',
      '--application-output',
      'stderr',
    ])

    expect(received).toMatchObject({
      pattern: 'features/**/*.feature',
      profiles: ['chromium', 'android'],
      selection: {
        states: ['active', 'draft'],
        shard: { index: 2, total: 3 },
      },
      concurrency: 4,
      outputs: [
        { format: 'json', path: 'run.json' },
        { format: 'junit', path: 'run.xml' },
      ],
      applicationOutput: { stdout: true, stderr: true },
    })
    expect(received?.selection).toEqual({
      states: ['active', 'draft'],
      shard: { index: 2, total: 3 },
    })
  })

  test('does not override suite filters with absent command options', async () => {
    let received: RunCommandInput | undefined
    const { cli } = program(
      cliActions({
        async run(input) {
          received = input
          return 0
        },
      }),
    )

    await cli.parse(['run', '--suite', 'smoke'])

    expect(received?.selection).toEqual({})
  })

  test('preserves the negated Studio open option', async () => {
    let received: StudioCommandInput | undefined
    const { cli } = program(
      cliActions({
        async studio(input) {
          received = input
          return 0
        },
      }),
    )

    await cli.parse(['studio', '--no-open', '--port', '0'])

    expect(received).toEqual({ open: false, port: 0 })
  })

  test('rejects conflicts, invalid values, and unknown commands', async () => {
    const { cli } = program()

    await expect(
      cli.parse(['run', '--refresh-cache', '--cache-only']),
    ).rejects.toThrow(
      "option '--refresh-cache' cannot be used with option '--cache-only'",
    )
    await expect(cli.parse(['run', '--concurrency', '0'])).rejects.toThrow(
      '--concurrency requires an integer greater than or equal to 1',
    )
    await expect(cli.parse(['unknown'])).rejects.toThrow(
      "unknown command 'unknown'",
    )
  })

  test('returns the selected action exit code', async () => {
    const { cli } = program(
      cliActions({
        async cache(input) {
          expect(input).toEqual({ operation: 'inspect' })
          return 7
        },
      }),
    )

    expect(await cli.parse(['cache', 'inspect'])).toBe(7)
  })
})
