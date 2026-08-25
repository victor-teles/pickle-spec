import {
  type TestRunExportRequest,
  testRunExportFormats,
} from '@pickle-spec/runner'

export function parseTestRunOutput(value: string): TestRunExportRequest {
  const separator = value.indexOf('=')
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error('--output requires format=path')
  }
  const format = value.slice(0, separator)
  if (
    !testRunExportFormats.includes(format as TestRunExportRequest['format'])
  ) {
    throw new Error(`Unsupported output format "${format}"`)
  }
  return {
    format: format as TestRunExportRequest['format'],
    path: value.slice(separator + 1),
  }
}
