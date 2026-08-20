import { expect, test } from 'bun:test'
import { runScenario } from '@pickle-spec/runner'
import { createMobileAdapter } from '../index'

const smokeEnabled = process.env.PICKLE_ANDROID_SMOKE === '1'
const smokeTest = smokeEnabled ? test : test.skip

smokeTest('runs one Scenario through a real Android Emulator', async () => {
  const applicationId = process.env.PICKLE_ANDROID_APP_ID
  const binaryPath = process.env.PICKLE_ANDROID_APP_PATH
  const stepText = process.env.PICKLE_ANDROID_SMOKE_STEP
  if (!applicationId || !binaryPath || !stepText) {
    throw new Error(
      'Set PICKLE_ANDROID_APP_ID, PICKLE_ANDROID_APP_PATH, and PICKLE_ANDROID_SMOKE_STEP',
    )
  }

  const scenario = {
    name: 'Android Emulator smoke',
    tags: [],
    steps: [{ keyword: 'Then', text: stepText, type: 'outcome' as const }],
  }
  const specification = {
    name: 'Mobile smoke',
    source: { uri: 'smoke/android.feature', language: 'en' },
    tags: [],
    scenarios: [scenario],
  }
  const adapter = createMobileAdapter({
    application: { id: applicationId, binaryPath },
    targetId: process.env.PICKLE_ANDROID_TARGET_ID,
    nodePath: process.env.PICKLE_NODE_PATH,
  })

  try {
    const targets = await adapter.discoverTargets()
    expect(targets.some((target) => target.state === 'booted')).toBe(true)
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'android-smoke' },
      adapter,
    })
    expect(run.result.state).toBe('passed')
  } finally {
    await adapter.dispose?.()
  }
})
