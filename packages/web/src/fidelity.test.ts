import { describe, expect, test } from 'bun:test'
import { resolveFidelityPolicy } from './fidelity'
import { validateWebAdapterOptions } from './web-options'

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
