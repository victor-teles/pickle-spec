type StableElement = {
  id: string
  tagName: string
  dataTest: string | null
  dataTestId: string | null
  name: string | null
}

export function observedSelectorNeedsStabilizing(selector: string): boolean {
  const trimmed = selector.trim()
  return (
    /^xpath=/i.test(trimmed) ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('(')
  )
}

export function stableSelectorFor(element: StableElement): string | undefined {
  if (element.id) {
    return /^[A-Za-z_][\w-]*$/.test(element.id)
      ? `#${element.id}`
      : `[id=${JSON.stringify(element.id)}]`
  }
  if (element.dataTest) return `[data-test=${JSON.stringify(element.dataTest)}]`
  if (element.dataTestId) {
    return `[data-testid=${JSON.stringify(element.dataTestId)}]`
  }
  if (element.name) {
    return `${element.tagName.toLowerCase()}[name=${JSON.stringify(element.name)}]`
  }
}

export function stabilizeXpathScript(xpath: string): string {
  return `(() => {
    const node = document.evaluate(
      ${JSON.stringify(xpath)},
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue
    if (!(node instanceof Element)) return null
    const stable = (${stableSelectorFor.toString()})({
      id: node.id,
      tagName: node.tagName,
      dataTest: node.getAttribute('data-test'),
      dataTestId: node.getAttribute('data-testid'),
      name: node.getAttribute('name'),
    })
    return stable ?? null
  })()`
}

export function xpathValue(selector: string): string {
  return selector.trim().replace(/^xpath=/i, '')
}

type EvaluablePage = {
  evaluate(expression: string): Promise<unknown>
}

export async function stabilizeSelector(
  page: EvaluablePage,
  selector: string,
): Promise<string> {
  if (!observedSelectorNeedsStabilizing(selector)) return selector
  try {
    const stable = await page.evaluate(
      stabilizeXpathScript(xpathValue(selector)),
    )
    return typeof stable === 'string' && stable.length > 0 ? stable : selector
  } catch {
    return selector
  }
}
