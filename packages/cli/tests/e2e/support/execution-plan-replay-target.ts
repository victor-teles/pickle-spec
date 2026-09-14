import { join } from 'node:path'
import {
  finalScenarioAttempt,
  runScenario,
  type ScenarioAttempt,
} from '@pickle-spec/runner'
import { parseSpecification } from '@pickle-spec/spec'
import {
  createWebAdapter,
  type WebAutomation,
  type WebAutomationFactory,
  type WebInstruction,
  type WebTemplate,
} from '@pickle-spec/web'
import type { Browser, Page } from 'playwright'
import type { ExecutionPlanBrowserProject } from './execution-plan-fixture'

const targetUrl = 'https://example.test/'
const targetHtml = `<!doctype html>
<html lang="en">
  <body>
    <button id="newer-writer">Account help</button>
    <input id="password" />
    <main id="account">Account ready</main>
  </body>
</html>`

function literal(template: WebTemplate): string {
  return template.segments
    .map((segment) => {
      if ('variable' in segment)
        throw new Error(`Unexpected variable ${segment.variable}`)
      return segment.literal
    })
    .join('')
}

async function executeInstruction(page: Page, instruction: WebInstruction) {
  if (instruction.kind === 'navigate') {
    await page.goto(literal(instruction.url))
    return { success: true }
  }
  if (instruction.kind === 'hover') {
    const selector = literal(instruction.locator.selector)
    const locator = page.locator(selector)
    if ((await locator.count()) === 0)
      return { success: false, actualState: `No element matches ${selector}` }
    await locator.hover()
    return { success: true }
  }
  if (instruction.kind === 'fill') {
    const selector = literal(instruction.locator.selector)
    const locator = page.locator(selector)
    if ((await locator.count()) === 0)
      return { success: false, actualState: `No element matches ${selector}` }
    await locator.fill(literal(instruction.value))
    return { success: true }
  }
  if (instruction.kind === 'visible') {
    const selector = literal(instruction.locator.selector)
    const locator = page.locator(selector).first()
    const success = await locator.isVisible().catch(() => false)
    return {
      success,
      actualState: success
        ? (await locator.textContent())?.trim()
        : 'Not visible',
    }
  }
  return {
    success: false,
    message: `Unsupported Replay instruction ${instruction.kind}`,
  }
}

function replayBrowserFactory(browser: Browser): WebAutomationFactory {
  return {
    async launch() {
      return {
        async openContext(input) {
          if (input.mode !== 'replay')
            throw new Error('Edited plan verification must use Replay')
          if (input.browser.modelApiKey !== undefined)
            throw new Error('Replay must not receive model credentials')
          const context = await browser.newContext()
          await context.route('**/*', (route) =>
            route.fulfill({ body: targetHtml, contentType: 'text/html' }),
          )
          const page = await context.newPage()
          const automation: WebAutomation = {
            async navigate(url) {
              await page.goto(url)
            },
            async observe() {
              throw new Error('Replay attempted observe inference')
            },
            async act() {
              throw new Error('Replay attempted act inference')
            },
            async verify() {
              throw new Error('Replay attempted verify inference')
            },
            async compileAssertion() {
              throw new Error('Replay attempted assertion inference')
            },
            executeInstruction: (instruction) =>
              executeInstruction(page, instruction),
            async screenshot() {
              return page.screenshot()
            },
            async readIsolationState() {
              if (page.isClosed()) return { cookieCount: 0, storageKeyCount: 0 }
              const cookies = await context.cookies()
              return { cookieCount: cookies.length, storageKeyCount: 0 }
            },
            async close() {
              await context.close()
            },
          }
          return automation
        },
        async close() {},
      }
    },
  }
}

export async function replayEditedPlanAgainstTarget(
  browser: Browser,
  seeded: ExecutionPlanBrowserProject,
): Promise<ScenarioAttempt> {
  const source = await Bun.file(
    join(seeded.project, 'features', 'eng04.feature'),
  ).text()
  const specification = parseSpecification({
    uri: 'features/eng04.feature',
    source,
  })
  const scenario = specification.scenarios.find(
    (candidate) => candidate.name === 'Complete cached plan',
  )
  if (!scenario) throw new Error('Replay verification Scenario is unavailable')
  const cacheEntry = (await seeded.cache.inspect()).find(
    (entry) => entry.key.scenarioId === scenario.id,
  )
  if (!cacheEntry) throw new Error('Edited Replay cache entry is unavailable')
  const adapter = createWebAdapter(
    { baseUrl: targetUrl },
    replayBrowserFactory(browser),
  )
  try {
    const replay = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'browser' },
      adapter,
      executionCache: {
        store: seeded.cache,
        projectKey: seeded.cache.projectKey,
        sourceRunId: 'edited-plan-replay',
      },
      applicationRevision: cacheEntry.key.applicationRevision,
      cachePolicy: 'cache-only',
    })
    return finalScenarioAttempt(replay.result)
  } finally {
    await adapter.dispose?.()
  }
}
