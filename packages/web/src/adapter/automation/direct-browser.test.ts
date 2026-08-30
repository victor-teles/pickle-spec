import { describe, expect, mock, test } from 'bun:test'
import type { BrowserContext, Locator, Page } from '@browserbasehq/stagehand'
import type { WebInstruction } from '../../execution-cache/web-execution-cache'
import { createDirectBrowser } from './direct-browser'

const literal = (value: string) => ({ segments: [{ literal: value }] })
const target = { selector: literal('#target') }

function browserFixture() {
  const locator = {
    first() {
      return this
    },
    nth() {
      return this
    },
    async count() {
      return 1
    },
    async isVisible() {
      return true
    },
    async innerText() {
      return 'Hello Alice'
    },
    async inputValue() {
      return 'alice@example.com'
    },
  } as unknown as Locator
  const page = {
    locator() {
      return locator
    },
    async url() {
      return 'https://example.test/account'
    },
  } as unknown as Page
  const context = {
    async activePage() {
      return page
    },
  } as unknown as BrowserContext
  return createDirectBrowser(context, {
    actionTimeoutMs: 100,
    navigationTimeoutMs: 100,
  })
}

describe('direct web assertions', () => {
  test('executes the eight closed assertion kinds without inference', async () => {
    const browser = browserFixture()
    const assertions: WebInstruction[] = [
      { kind: 'exists', locator: target },
      { kind: 'visible', locator: target },
      { kind: 'hidden', locator: { selector: literal('#missing'), nth: 1 } },
      {
        kind: 'text-equals',
        locator: target,
        expected: literal('Hello Alice'),
      },
      {
        kind: 'text-contains',
        locator: target,
        expected: literal('Alice'),
      },
      {
        kind: 'value-equals',
        locator: target,
        expected: literal('alice@example.com'),
      },
      { kind: 'count-equals', locator: target, expected: 1 },
      {
        kind: 'url-equals',
        expected: literal('https://example.test/account'),
      },
    ]

    for (const assertion of assertions) {
      expect(await browser.execute(assertion, [])).toMatchObject({
        success: true,
      })
    }
  })

  test('returns the deterministic actual state when an assertion fails', async () => {
    const result = await browserFixture().execute(
      {
        kind: 'text-equals',
        locator: target,
        expected: literal('Goodbye'),
      },
      [],
    )

    expect(result).toEqual({
      success: false,
      actualState: 'Hello Alice',
      message: 'Expected "Goodbye" but received "Hello Alice"',
    })
  })
})

describe('direct web actions', () => {
  test('executes the closed action and wait vocabulary through browser primitives', async () => {
    const sendClickEvent = mock(async () => {})
    const fill = mock(async () => {})
    const type = mock(async () => {})
    const hover = mock(async () => {})
    const selectOption = mock(async () => [])
    const locator = {
      first() {
        return this
      },
      nth() {
        return this
      },
      count: mock(async () => 1),
      isVisible: mock(async () => true),
      sendClickEvent,
      fill,
      type,
      hover,
      selectOption,
    } as unknown as Locator
    const page = {
      locator: mock(() => locator),
    } as unknown as Page
    const context = {
      activePage: mock(async () => page),
    } as unknown as BrowserContext
    const browser = createDirectBrowser(context, {
      actionTimeoutMs: 100,
      navigationTimeoutMs: 100,
    })
    const actions: WebInstruction[] = [
      { kind: 'click', locator: target },
      { kind: 'fill', locator: target, value: literal('Alice') },
      { kind: 'type', locator: target, value: literal(' Smith') },
      { kind: 'hover', locator: target },
      {
        kind: 'select-option',
        locator: target,
        values: [literal('one'), literal('two')],
      },
      { kind: 'wait-for', locator: target, state: 'visible' },
    ]

    for (const action of actions) {
      expect(await browser.execute(action, [])).toEqual({ success: true })
    }

    expect(sendClickEvent).toHaveBeenCalledTimes(1)
    expect(fill).toHaveBeenCalledWith('Alice')
    expect(type).toHaveBeenCalledWith(' Smith')
    expect(hover).toHaveBeenCalledTimes(1)
    expect(selectOption).toHaveBeenCalledWith(['one', 'two'])
  })

  test('waits for a locator to attach before filling', async () => {
    let counts = 0
    const fill = mock(async () => {})
    const locator = {
      first() {
        return this
      },
      nth() {
        return this
      },
      count: mock(async () => {
        counts++
        return counts >= 2 ? 1 : 0
      }),
      isVisible: mock(async () => false),
      fill,
    } as unknown as Locator
    const page = {
      locator: mock(() => locator),
    } as unknown as Page
    const context = {
      activePage: mock(async () => page),
    } as unknown as BrowserContext
    const browser = createDirectBrowser(context, {
      actionTimeoutMs: 200,
      navigationTimeoutMs: 100,
    })

    expect(
      await browser.execute(
        { kind: 'fill', locator: target, value: literal('standard_user') },
        [],
      ),
    ).toEqual({ success: true })
    expect(counts).toBeGreaterThanOrEqual(2)
    expect(fill).toHaveBeenCalledWith('standard_user')
  })
})
