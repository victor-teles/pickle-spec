export function abortError(): DOMException {
  return new DOMException('Scenario cancelled', 'AbortError')
}
