import { describe, expect, it } from 'vitest'

import { releaseChannelForVersion, releaseCoordinates } from '../../scripts/release-target.mjs'

describe('release target policy', () => {
  it('derives stable and prerelease channels from each package version', () => {
    expect(releaseChannelForVersion('1.0.0')).toBe('latest')
    expect(releaseChannelForVersion('1.1.0-beta.1')).toBe('next')
  })

  it('keeps the coupled Vue/Nuxt and independent MCP tag spaces separate', () => {
    expect(releaseCoordinates('vue-nuxt', '1.0.0', '2.0.0')).toEqual({
      tag: 'v1.0.0',
      version: '1.0.0',
    })
    expect(releaseCoordinates('mcp', '1.0.0', '2.0.0')).toEqual({
      tag: 'mcp-v2.0.0',
      version: '2.0.0',
    })
  })
})
