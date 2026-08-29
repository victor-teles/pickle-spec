import { describe, expect, test } from 'vitest'
import {
  optionalBoolean,
  optionalPositiveInteger,
  optionalString,
  parseConfiguration,
  strictObject,
} from '../index'

describe('configuration validation', () => {
  const schema = strictObject('settings', {
    enabled: optionalBoolean('settings.enabled'),
    label: optionalString('settings.label'),
    retries: optionalPositiveInteger('settings.retries'),
  })

  test('parses valid configuration values', () => {
    expect(
      parseConfiguration(
        schema,
        { enabled: true, label: 'fast', retries: 2 },
        'Invalid settings',
      ),
    ).toEqual({ enabled: true, label: 'fast', retries: 2 })
  })

  test('reports field-specific validation errors', () => {
    expect(() =>
      parseConfiguration(schema, { retries: 0 }, 'Invalid settings'),
    ).toThrow('settings.retries must be an integer greater than or equal to 1')
  })

  test('reports unsupported keys with their full path', () => {
    expect(() =>
      parseConfiguration(schema, { unknown: true }, 'Invalid settings'),
    ).toThrow('settings.unknown is not supported')
  })
})
