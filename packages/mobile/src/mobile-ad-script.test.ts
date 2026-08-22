import { expect, test } from 'bun:test'
import { compileMobileScenario } from './mobile-ad-script'
import { mobileReplayVariableName } from './mobile-execution-cache'

const nameVariable = mobileReplayVariableName('name')
const namePlaceholder = ['$', `{${nameVariable}}`].join('')

test('renders the closed native assertion vocabulary into one full .ad Scenario', () => {
  const templateSteps = [
    {
      type: 'outcome' as const,
      text: 'text: id="greeting" = Hello <name>',
    },
    { type: 'outcome' as const, text: 'visible: id="receipt"' },
    { type: 'outcome' as const, text: 'hidden: id="spinner"' },
    { type: 'outcome' as const, text: 'exists: id="cart"' },
    { type: 'outcome' as const, text: 'editable: id="email"' },
    { type: 'outcome' as const, text: 'selected: id="terms"' },
    { type: 'outcome' as const, text: 'focused: id="email"' },
  ]
  const runtimeSteps = templateSteps.map((step) => ({
    ...step,
    text: step.text.replace('<name>', 'Victor'),
  }))

  const compiled = compileMobileScenario({
    platform: 'ios',
    applicationId: 'com.example.checkout',
    scenario: {
      steps: runtimeSteps,
      templateSteps,
      runtimeBindings: [{ name: 'name', value: 'Victor' }],
    },
  })

  expect(compiled.payload.script).toBe(
    'context platform=ios\n' +
      'open "com.example.checkout" --relaunch\n' +
      `is text "id=\\"greeting\\"" "Hello ${namePlaceholder}"\n` +
      'is visible "id=\\"receipt\\""\n' +
      'is hidden "id=\\"spinner\\""\n' +
      'is exists "id=\\"cart\\""\n' +
      'is editable "id=\\"email\\""\n' +
      'is selected "id=\\"terms\\""\n' +
      'is focused "id=\\"email\\""\n',
  )
  expect(compiled.requiredVariables).toEqual(['name'])
  expect(compiled.runtimeEnv).toEqual([`${nameVariable}=Victor`])
  expect(compiled.uncacheableReason).toBeUndefined()
})

test('marks data arguments and malformed text assertions as uncacheable', () => {
  const argument = compileMobileScenario({
    platform: 'android',
    applicationId: 'com.example.checkout',
    scenario: {
      steps: [
        {
          type: 'action',
          text: 'Submit form',
          argument: { docString: 'private runtime value' },
        },
      ],
      templateSteps: [
        {
          type: 'action',
          text: 'Submit form',
          argument: { docString: '<private>' },
        },
      ],
      runtimeBindings: [{ name: 'private', value: 'private runtime value' }],
    },
  })
  const assertion = compileMobileScenario({
    platform: 'android',
    applicationId: 'com.example.checkout',
    scenario: {
      steps: [{ type: 'outcome', text: 'text: id="greeting"' }],
      templateSteps: [{ type: 'outcome', text: 'text: id="greeting"' }],
      runtimeBindings: [],
    },
  })

  expect(argument.uncacheableReason).toBe('non-deterministic-action')
  expect(argument.payload.script).not.toContain('private runtime value')
  expect(assertion.uncacheableReason).toBe('non-deterministic-assertion')
})
