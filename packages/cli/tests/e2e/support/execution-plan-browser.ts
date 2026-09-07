import { resolve } from 'node:path'
import type { Locator, Page } from 'playwright'

export const evidenceDirectory = resolve(
  import.meta.dir,
  '../../../../../.audit/eng04/browser-screenshots',
)

export function workbenchRail(page: Page): Locator {
  return page
    .getByRole('tablist', { name: 'Specifications workbench rail' })
    .locator('xpath=ancestor::aside')
}

export async function showDetails(page: Page): Promise<void> {
  const hidden = page.getByRole('button', { name: 'Show Right sidebar' })
  if (await hidden.isVisible()) await hidden.click()
}

export async function inspectScenario(
  page: Page,
  scenarioName: string,
  profile = 'browser',
): Promise<Locator> {
  await page
    .getByRole('button', { name: 'Specifications', exact: true })
    .click()
  const showLeft = page.getByRole('button', { name: 'Show Left sidebar' })
  if (await showLeft.isVisible()) await showLeft.click()
  await workbenchRail(page)
    .getByRole('button', { name: scenarioName, exact: true })
    .click()
  const showBottom = page.getByRole('button', { name: 'Show Bottom panel' })
  if (await showBottom.isVisible()) await showBottom.click()
  await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  await page.getByText('Readable execution plan', { exact: true }).waitFor()
  const inspect = page.getByRole('button', {
    name: `Inspect ${profile}`,
    exact: true,
  })
  if ((await inspect.count()) === 0) {
    const labels = await page.locator('button').allTextContents()
    throw new Error(
      `Missing Inspect ${profile}. Buttons: ${labels.join(' | ')}`,
    )
  }
  await inspect.click()
  return page.getByRole('region', { name: 'Readable execution plan' }).last()
}

export async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    await page.keyboard.press('Tab')
    if (await target.evaluate((element) => element.matches(':focus'))) return
  }
  throw new Error(`Keyboard focus did not reach ${target}`)
}

export async function waitForStudio(
  page: Page,
  projectName: string,
  browserErrors: readonly string[] = [],
): Promise<void> {
  try {
    await page
      .getByRole('button', { name: 'Specifications', exact: true })
      .waitFor({ timeout: 10_000 })
  } catch {
    throw new Error(
      `Studio did not render ${projectName} at ${page.url()}. ${browserErrors.join(' | ')} ${await page.content()}`,
    )
  }
}
