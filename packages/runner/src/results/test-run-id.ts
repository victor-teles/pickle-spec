export function validateTestRunId(id: string): void {
  if (
    !id ||
    id === '.' ||
    id === '..' ||
    id.includes('/') ||
    id.includes('\\')
  ) {
    throw new Error(`Invalid test run identifier "${id}"`)
  }
}
