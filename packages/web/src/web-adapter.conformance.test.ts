import { defineAdapterConformanceSuite } from '@pickle-spec/runner/testing'
import type { Scenario, Specification } from '@pickle-spec/spec'
import {
  createWebAdapter,
  type WebAutomation,
  type WebAutomationFactory,
} from '../index'

const scenario: Scenario = {
  name: 'Search for pickles',
  tags: ['@web'],
  steps: [{ keyword: 'When', text: 'I search for pickles', type: 'action' }],
}

const specification: Specification = {
  name: 'Search',
  source: { uri: 'features/search.feature', language: 'en' },
  tags: ['@web'],
  scenarios: [scenario],
}

function conformanceAutomation(): WebAutomation {
  return {
    async navigate() {},
    async observe() {
      return [
        {
          description: 'Fill the search field',
          handle: { selector: '#search' },
        },
      ]
    },
    async act() {
      return { success: true }
    },
    async verify() {
      return { meetsExpectation: true, actualState: 'Ready' }
    },
    async screenshot() {
      return new Uint8Array()
    },
    async readIsolationState() {
      return { cookieCount: 0, storageKeyCount: 0 }
    },
    async close() {},
  }
}

const factory: WebAutomationFactory = {
  async launch() {
    return {
      async openContext() {
        return conformanceAutomation()
      },
      async close() {},
    }
  },
}

defineAdapterConformanceSuite({
  name: 'Web',
  createAdapter: () =>
    createWebAdapter({ baseUrl: 'https://example.test' }, factory),
  executionTargetProfile: { id: 'web' },
  specification,
  scenario,
  expectedCapabilities: ['web', 'screenshots'],
})
