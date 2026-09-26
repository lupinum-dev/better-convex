import { describe, expect, it } from 'vitest'

import {
  adoptCandidateTuple,
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

  it('moves a published app copy to the exact candidate tuple', () => {
    const manifest = {
      dependencies: {
        '@better-auth/oauth-provider': '1.7.2',
        '@lupinum/better-convex-mcp': 'file:./better-convex-mcp.tgz',
        '@modelcontextprotocol/server': '2.0.0',
        'better-auth': '1.7.2',
        convex: '1.42.2',
        zod: '4.4.3',
      },
    }

    adoptCandidateTuple(manifest, [
      {
        name: '@lupinum/better-convex-nuxt',
        peerDependencies: {
          '@better-auth/core': '1.7.6',
          '@better-auth/oauth-provider': '1.7.6',
          'better-auth': '1.7.6',
          convex: '>=1.42.2 <2',
        },
      },
      {
        name: '@lupinum/better-convex-mcp',
        dependencies: { '@modelcontextprotocol/server': '2.1.0' },
      },
    ])

    expect(manifest.dependencies).toEqual({
      '@better-auth/oauth-provider': '1.7.6',
      '@lupinum/better-convex-mcp': 'file:./better-convex-mcp.tgz',
      '@modelcontextprotocol/server': '2.1.0',
      'better-auth': '1.7.6',
      convex: '1.42.2',
      zod: '4.4.3',
    })
    expect(() =>
      adoptCandidateTuple(manifest, [{ name: '@lupinum/better-convex-mcp', dependencies: {} }]),
    ).toThrow('must declare one exact shared @modelcontextprotocol/server runtime')
  })
})
