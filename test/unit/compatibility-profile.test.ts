import { describe, expect, it } from 'vitest'

import {
  applyCompatibilityProfile,
  compatibilityProfiles,
  compatibilityProfileNames,
} from '../../scripts/compatibility-profile.mjs'
import {
  supportedDependencyTuple,
  supportedPeerRanges,
} from '../../scripts/supported-dependency-tuple.mjs'

describe('packed compatibility profiles', () => {
  it('changes only declared compatibility dependencies', () => {
    const manifest = {
      dependencies: {
        convex: 'old',
        untouched: '1.0.0',
      },
      devDependencies: {
        '@nuxt/schema': 'old',
        nuxt: 'old',
        vue: 'old',
      },
    }

    applyCompatibilityProfile(manifest, 'floor')

    expect(manifest).toEqual({
      dependencies: {
        convex: supportedDependencyTuple.convex,
        untouched: '1.0.0',
      },
      devDependencies: {
        '@nuxt/schema': supportedDependencyTuple.nuxt,
        nuxt: supportedDependencyTuple.nuxt,
        vue: compatibilityProfiles.floor.vue,
      },
    })
  })

  it('keeps latest resolution inside the reviewed major lines', () => {
    const manifest = {
      dependencies: { convex: 'old', nuxt: 'old', vue: 'old' },
    }

    applyCompatibilityProfile(manifest, 'latest-compatible')

    expect(manifest.dependencies).toEqual({
      convex: supportedPeerRanges.convex,
      nuxt: supportedPeerRanges.nuxt,
      vue: compatibilityProfiles['latest-compatible'].vue,
    })
  })

  it('rejects unknown profiles', () => {
    expect(compatibilityProfileNames).toEqual(['floor', 'latest-compatible'])
    expect(() => applyCompatibilityProfile({}, 'future')).toThrow('Unknown compatibility profile')
  })
})
