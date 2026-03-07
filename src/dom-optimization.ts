import type { Stagehand } from '@browserbasehq/stagehand'
import { withCancellation } from './cancellation'

type Page = ReturnType<Stagehand['context']['pages']>[number]

export async function simplifyDOM(page: Page): Promise<void> {
  await page.evaluate(`
    document.querySelectorAll('video, iframe').forEach(el => el.remove());
    if (!document.querySelector('style[data-pickle-dom-opt]')) {
      const style = document.createElement('style');
      style.setAttribute('data-pickle-dom-opt', '');
      style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
      document.head.appendChild(style);
    }
  `)
}

export async function navigateAndSimplify(
  page: Page,
  url: string,
  opts: { waitUntil?: 'domcontentloaded' | 'load' | 'networkidle'; timeoutMs?: number },
  simplify: boolean,
): Promise<void> {
  await withCancellation(page.goto(url, opts))
  if (simplify) {
    try { await simplifyDOM(page) } catch {}
  }
}
