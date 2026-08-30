import { describe, expect, test } from 'vitest'
import { resolveFidelityPolicy } from '../../../../src/adapter/configuration/fidelity'
import { validateWebAdapterOptions } from '../../../../src/adapter/configuration/web-options'

describe('resolveFidelityPolicy', () => {
  test('preserves full fidelity for the default profile', () => {
    expect(
      resolveFidelityPolicy(
        validateWebAdapterOptions({
          baseUrl: 'https://example.test',
        }),
      ),
    ).toEqual({
      profile: 'default',
      tradeOffs: [],
      blockResources: [],
      disableAnimations: false,
    })
  })

  test('records every enabled fast profile trade-off', () => {
    expect(
      resolveFidelityPolicy(
        validateWebAdapterOptions({
          baseUrl: 'https://example.test',
          profile: 'fast',
        }),
      ),
    ).toEqual({
      profile: 'fast',
      tradeOffs: [
        'block-image',
        'block-media',
        'block-font',
        'disable-animations',
      ],
      blockResources: ['image', 'media', 'font'],
      disableAnimations: true,
    })
  })

  test('rejects fidelity overrides unless the fast profile is selected', () => {
    expect(() =>
      validateWebAdapterOptions({
        baseUrl: 'https://example.test',
        fidelity: { disableAnimations: true },
      }),
    ).toThrow('web.fidelity requires web.profile fast')
  })
})
