import type { BrowserContext } from '@browserbasehq/stagehand'
import {
  type BlockedResourceType,
  blockedResourceTypes,
  type ResolvedFidelity,
} from '../configuration/fidelity'

interface FidelityRoute {
  request: () => { resourceType: () => string }
  abort: () => Promise<void>
  continue: () => Promise<void>
}

interface FidelityBrowserPage {
  addInitScript: (script: string) => Promise<void>
}

interface FidelityBrowserContext {
  route?: (
    pattern: string,
    handler: (route: FidelityRoute) => Promise<void>,
  ) => Promise<void>
  unroute?: (pattern: string) => Promise<void>
  activePage: () => Promise<FidelityBrowserPage | undefined>
}

function isBlockedResourceType(value: string): value is BlockedResourceType {
  return blockedResourceTypes.some((type) => type === value)
}

export async function applyStagehandFidelity(
  browserContext: BrowserContext,
  fidelity?: ResolvedFidelity,
): Promise<void> {
  const context: FidelityBrowserContext = browserContext
  if (!fidelity || fidelity.profile === 'default') {
    if (context.unroute) await context.unroute('**/*')
    return
  }

  const blocked = new Set(fidelity.blockResources)
  if (context.unroute) await context.unroute('**/*')
  if (blocked.size > 0 && context.route) {
    await context.route('**/*', (route) => {
      const resourceType = route.request().resourceType()
      if (isBlockedResourceType(resourceType) && blocked.has(resourceType)) {
        return route.abort()
      }
      return route.continue()
    })
  }
  if (!fidelity.disableAnimations) return
  const page = await context.activePage()
  if (!page) return
  await page.addInitScript(`
    (() => {
      const style = document.createElement('style')
      style.textContent =
        '*, *::before, *::after { animation: none !important; transition: none !important; }'
      document.documentElement.appendChild(style)
    })()
  `)
}
