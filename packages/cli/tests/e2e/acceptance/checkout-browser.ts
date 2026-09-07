import type { ScenarioVariableBinding } from '@pickle-spec/spec'
import type {
  WebAutomation,
  WebAutomationFactory,
  WebInstruction,
  WebObservedAction,
  WebTemplate,
} from '@pickle-spec/web'
import type { Browser, BrowserContext, Locator, Page } from 'playwright'

export type FixtureVariant =
  | 'original'
  | 'changed-target'
  | 'business-regression'
export type CompilerTarget = 'original' | 'changed-target'
export const acceptanceBaseUrl = 'https://acceptance.pickle.test/'

type FactoryInput = {
  browser: Browser
  compilerTarget: CompilerTarget
  html: string
  launches: { count: number }
}

type AssertionCompilation = Awaited<
  ReturnType<NonNullable<WebAutomation['compileAssertion']>>
>
type ScreenshotCapture = Parameters<WebAutomation['screenshot']>[0]

type AcceptanceAction = {
  method?: string
  selector: string
  arguments?: string[]
}

const actions = {
  'I sign in with the valid acceptance account': {
    selector: '#username',
    method: 'fill',
    arguments: ['acceptance_user'],
  },
  'sign in password': {
    selector: '#password',
    method: 'fill',
    arguments: ['pickle_pass'],
  },
  'submit sign in': { selector: '#login-form button[type="submit"]' },
  'I add the backpack to the basket': { selector: '#add-backpack' },
  'I place the order': { selector: '#place-order' },
} satisfies Record<string, AcceptanceAction>

const assertions = {
  'the product catalog is visible': {
    kind: 'visible',
    selector: '#catalog-view',
  },
  'the basket contains one backpack': {
    kind: 'text-equals',
    selector: '#basket-count',
    expected: '1',
  },
  'the order summary shows one backpack with a total of $29.99': [
    { kind: 'text-equals', selector: '#summary-count', expected: '1' },
    { kind: 'text-equals', selector: '#order-total', expected: '$29.99' },
  ],
  'the confirmation shows one completed order': {
    kind: 'text-equals',
    selector: '#order-count',
    expected: '1',
  },
} satisfies Record<string, AssertionCompilation>

function findAction(description: string): AcceptanceAction | undefined {
  return Object.entries(actions).find(([key]) => key === description)?.[1]
}

function findAssertion(prompt: string): AssertionCompilation | undefined {
  return Object.entries(assertions).find(([key]) => key === prompt)?.[1]
}

export function digest(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

function literal(template: WebTemplate): string {
  return template.segments
    .map((segment) => {
      if ('variable' in segment)
        throw new Error(`Unexpected variable ${segment.variable}`)
      return segment.literal
    })
    .join('')
}

async function visibleText(page: Page, selector: string): Promise<string> {
  const locator = page.locator(selector)
  if ((await locator.count()) === 0) return `No element matches ${selector}`
  if (!(await locator.first().isVisible())) return `${selector} is hidden`
  return (await locator.first().textContent())?.trim() ?? ''
}

async function executeLocated(
  page: Page,
  instruction: Exclude<WebInstruction, { kind: 'navigate' | 'url-equals' }>,
  selector: string,
  locator: Locator,
) {
  if (instruction.kind === 'click') {
    if ((await locator.count()) === 0)
      return { success: false, actualState: `No element matches ${selector}` }
    await locator.click()
    return { success: true }
  }
  if (instruction.kind === 'fill' || instruction.kind === 'type') {
    const value = literal(instruction.value)
    if (instruction.kind === 'fill') await locator.fill(value)
    else await locator.pressSequentially(value)
    return { success: true }
  }
  if (instruction.kind === 'visible') {
    const actualState = await visibleText(page, selector)
    return {
      success: await locator
        .first()
        .isVisible()
        .catch(() => false),
      actualState,
    }
  }
  if (instruction.kind === 'text-equals') {
    const expected = literal(instruction.expected)
    const actualState = await visibleText(page, selector)
    return { success: actualState === expected, actualState }
  }
  throw new Error(`Acceptance executor does not support ${instruction.kind}`)
}

async function execute(page: Page, instruction: WebInstruction) {
  if (instruction.kind === 'navigate') {
    await page.goto(literal(instruction.url))
    return { success: true }
  }
  if (instruction.kind === 'url-equals') {
    const expected = literal(instruction.expected)
    return { success: page.url() === expected, actualState: page.url() }
  }
  const selector = literal(instruction.locator.selector)
  return executeLocated(page, instruction, selector, page.locator(selector))
}

class AcceptanceAutomation implements WebAutomation {
  constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly mode: 'adaptive' | 'replay',
    private readonly compilerTarget: CompilerTarget,
  ) {}

  async navigate(url: string) {
    await this.page.goto(url)
  }

  async observe(prompt: string): Promise<WebObservedAction[]> {
    if (this.mode === 'replay')
      throw new Error('Replay attempted observe inference')
    const action = prompt.split('needed to: ')[1]
    if (!action) return []
    if (action === 'I sign in with the valid acceptance account') {
      return [
        'I sign in with the valid acceptance account',
        'sign in password',
        'submit sign in',
      ].map((key) => {
        const handle = findAction(key)
        if (!handle) throw new Error(`No controlled action for: ${key}`)
        return { description: key, handle }
      })
    }
    if (action === 'I start checkout') {
      return [
        {
          description: action,
          handle: {
            selector:
              this.compilerTarget === 'original'
                ? '#start-checkout'
                : '#review-order',
          },
        },
      ]
    }
    const payload = findAction(action)
    return payload ? [{ description: action, handle: payload }] : []
  }

  async act(): Promise<never> {
    throw new Error(`${this.mode} attempted legacy act inference`)
  }

  async verify(): Promise<never> {
    throw new Error(`${this.mode} attempted legacy verify inference`)
  }

  async compileAssertion(prompt: string): Promise<AssertionCompilation> {
    if (this.mode === 'replay')
      throw new Error('Replay attempted assertion inference')
    const assertion = findAssertion(prompt)
    if (!assertion) throw new Error(`No controlled assertion for: ${prompt}`)
    return assertion
  }

  async executeInstruction(
    instruction: WebInstruction,
    _bindings: readonly ScenarioVariableBinding[],
  ) {
    return execute(this.page, instruction)
  }

  async screenshot(options: ScreenshotCapture) {
    return this.page.screenshot({
      type: options.format,
      fullPage: options.fullPage,
    })
  }

  async readIsolationState() {
    if (this.page.isClosed()) return { cookieCount: 0, storageKeyCount: 0 }
    const cookies = await this.context.cookies()
    const storageKeyCount =
      this.page.url() === 'about:blank'
        ? 0
        : await this.page.evaluate(
            () => sessionStorage.length + localStorage.length,
          )
    return { cookieCount: cookies.length, storageKeyCount }
  }

  async close() {
    await this.context.close()
  }
}

export function acceptanceFactory(input: FactoryInput): WebAutomationFactory {
  return {
    async launch() {
      input.launches.count++
      return {
        async openContext(contextInput) {
          if (
            contextInput.mode === 'replay' &&
            contextInput.browser.modelApiKey !== undefined
          ) {
            throw new Error(
              'Acceptance runs must not receive model credentials',
            )
          }
          const context = await input.browser.newContext({
            viewport: { width: 320, height: 720 },
          })
          await context.route(`${acceptanceBaseUrl}**`, (route) =>
            route.fulfill({ body: input.html, contentType: 'text/html' }),
          )
          const page = await context.newPage()
          return new AcceptanceAutomation(
            context,
            page,
            contextInput.mode ?? 'adaptive',
            input.compilerTarget,
          )
        },
        async close() {},
      }
    },
  }
}
