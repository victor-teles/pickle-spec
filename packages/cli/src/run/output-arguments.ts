import {
  type TestRunExportRequest,
  testRunExportFormats,
} from '@pickle-spec/runner'

export function parseTestRunOutput(value: string): TestRunExportRequest {
  const separator = value.indexOf('=')
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error('--output requires format=path')
  }
  const requestedFormat = value.slice(0, separator)
  const format = testRunExportFormats.find(
    (candidate) => candidate === requestedFormat,
  )
  if (!format) {
    throw new Error(`Unsupported output format "${requestedFormat}"`)
  }
  return {
    format,
    path: value.slice(separator + 1),
  }
}
