import { describe, expect, test } from 'vitest'
import {
  optionalBoolean,
  optionalPositiveInteger,
  optionalString,
  configurationParser,
  strictObject,
} from '../../index'

describe('configuration validation', () => {
  const schema = strictObject('settings', {
    enabled: optionalBoolean('settings.enabled'),
    label: optionalString('settings.label'),
    retries: optionalPositiveInteger('settings.retries'),
  })

  const parseSettings = configurationParser(schema, 'Invalid settings')

  test('parses valid configuration values', () => {
    expect(parseSettings({ enabled: true, label: 'fast', retries: 2 })).toEqual(
      { enabled: true, label: 'fast', retries: 2 },
    )
  })

  test('reports field-specific validation errors', () => {
    expect(() => parseSettings({ retries: 0 })).toThrow(
      'settings.retries must be an integer greater than or equal to 1',
    )
  })

  test('reports unsupported keys with their full path', () => {
    expect(() => parseSettings({ unknown: true })).toThrow(
      'settings.unknown is not supported',
    )
  })
})
