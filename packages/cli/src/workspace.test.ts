import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

describe('public CLI workspace seam', () => {
  let workspace: string
  let pickleCommand: string

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'pickle-spec-workspace-'))
    const packageDirectory = resolve(import.meta.dir, '..')
    const packageManifest = await Bun.file(join(packageDirectory, 'package.json')).json() as {
      bin: { pickle: string }
    }
    pickleCommand = join(workspace, 'node_modules', '.bin', 'pickle')
    await mkdir(join(workspace, 'node_modules', '.bin'), { recursive: true })
    await symlink(resolve(packageDirectory, packageManifest.bin.pickle), pickleCommand)
    await Bun.write(join(workspace, 'purchase.feature'), `Feature: Purchase
  Scenario: Complete a purchase
    Given a product is in the basket
    Then the purchase succeeds`)
    await Bun.write(join(workspace, 'pickle.extensions.ts'), `
const state = process.env.PICKLE_TEST_OUTCOME ?? 'passed'

export default {
  executionTargetProfile: { id: 'deterministic' },
  adapter: {
    async openSession() {
      return {
        async executeStep(step) {
          return {
            state,
            resolvedActions: [{ description: \`Deterministic action: \${step.text}\` }],
          }
        },
        async close() {},
      }
    },
  },
}
`)
  })

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  test('runs one Specification and Scenario through public CLI and runner interfaces', async () => {
    const process = Bun.spawn({
      cmd: [
        pickleCommand,
        'run',
        'purchase.feature',
        '--extensions',
        'pickle.extensions.ts',
      ],
      cwd: workspace,
      env: { ...Bun.env, PICKLE_TEST_OUTCOME: 'passed' },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ])

    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    const records = stdout.trim().split('\n').map(line => JSON.parse(line))
    expect(records.filter(record => record.kind === 'run-event').map(record => record.event.type)).toEqual([
      'scenario-started',
      'step-started',
      'step-finished',
      'step-started',
      'step-finished',
      'scenario-finished',
    ])
    expect(records.at(-1)).toMatchObject({
      kind: 'test-result',
      result: {
        schemaVersion: 1,
        specification: { name: 'Purchase' },
        scenario: { name: 'Complete a purchase' },
        executionTargetProfile: { id: 'deterministic' },
        state: 'passed',
      },
    })
    expect(stdout).not.toContain('gherkinDocument')
    expect(stdout).not.toContain('Stagehand')
  })

  test('the deterministic adapter models every kernel outcome', async () => {
    const cases = [
      { outcome: 'passed', exitCode: 0 },
      { outcome: 'passed-with-adaptation', exitCode: 0 },
      { outcome: 'failed', exitCode: 1 },
      { outcome: 'cancelled', exitCode: 130 },
      { outcome: 'infrastructure-error', exitCode: 1 },
    ] as const

    for (const expected of cases) {
      const process = Bun.spawn({
        cmd: [
          pickleCommand,
          'run',
          'purchase.feature',
          '--extensions',
          'pickle.extensions.ts',
        ],
        cwd: workspace,
        env: { ...Bun.env, PICKLE_TEST_OUTCOME: expected.outcome },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ])
      const records = stdout.trim().split('\n').map(line => JSON.parse(line))

      expect(stderr).toBe('')
      expect(exitCode).toBe(expected.exitCode)
      expect(records.at(-1)).toMatchObject({
        kind: 'test-result',
        result: {
          schemaVersion: 1,
          state: expected.outcome,
        },
      })
    }
  })
})
