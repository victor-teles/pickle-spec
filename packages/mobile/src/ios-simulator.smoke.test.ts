import { expect, test } from 'bun:test'
import { runScenario } from '@pickle-spec/runner'
import { createMobileAdapter } from '../index'

const smokeEnabled = process.env.PICKLE_IOS_SMOKE === '1'
const smokeTest = smokeEnabled ? test : test.skip

smokeTest('runs one Scenario through a real iOS Simulator', async () => {
  const applicationId = process.env.PICKLE_IOS_APP_ID
  const binaryPath = process.env.PICKLE_IOS_APP_PATH
  const stepText = process.env.PICKLE_IOS_SMOKE_STEP
  if (!applicationId || !binaryPath || !stepText) {
    throw new Error(
      'Set PICKLE_IOS_APP_ID, PICKLE_IOS_APP_PATH, and PICKLE_IOS_SMOKE_STEP',
    )
  }

  const scenario = {
    name: 'iOS Simulator smoke',
    tags: [],
    steps: [{ keyword: 'Then', text: stepText, type: 'outcome' as const }],
  }
  const specification = {
    name: 'Mobile smoke',
    source: { uri: 'smoke/ios.feature', language: 'en' },
    tags: [],
    scenarios: [scenario],
  }
  const adapter = createMobileAdapter({
    executionTarget: 'ios-simulator',
    application: { id: applicationId, binaryPath },
    targetId: process.env.PICKLE_IOS_TARGET_ID,
    nodePath: process.env.PICKLE_NODE_PATH,
  })

  try {
    const targets = await adapter.discoverTargets()
    expect(targets.some((target) => target.state === 'booted')).toBe(true)
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'ios-smoke' },
      adapter,
    })
    expect(run.result.state).toBe('passed')
  } finally {
    await adapter.dispose?.()
  }
})
