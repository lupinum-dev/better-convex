import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  supportedDependencyTuple,
  supportedPeerRanges,
} from '../../scripts/supported-dependency-tuple.mjs'

const root = join(import.meta.dirname, '../..')

describe('supported version alignment', () => {
  it('derives every advertised Nuxt version from the package tuple', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: { '@nuxt/kit': string }
      peerDependencies: { nuxt: string }
    }
    const moduleSource = readFileSync(join(root, 'src/module.ts'), 'utf8')
    const securityContract = readFileSync(join(root, 'SECURITY.md'), 'utf8')

    const nuxtVersion = supportedDependencyTuple.nuxt
    expect(manifest.peerDependencies.nuxt).toBe(supportedPeerRanges.nuxt)
    expect(manifest.dependencies['@nuxt/kit']).toBe(nuxtVersion)
    expect(supportedDependencyTuple['@nuxt/kit']).toBe(nuxtVersion)
    expect(moduleSource).toContain(`nuxt: '${supportedPeerRanges.nuxt}'`)
    expect(securityContract).toContain(`Nuxt \`${nuxtVersion}\``)
  })

  it('keeps auth optional, exact, and consumer-owned', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies: Record<string, string>
      peerDependencies: Record<string, string>
      peerDependenciesMeta?: Record<string, { optional?: boolean }>
    }
    for (const name of ['better-auth', '@better-auth/oauth-provider'] as const) {
      const version = supportedDependencyTuple[name]
      expect(manifest.peerDependencies[name]).toBe(version)
      expect(manifest.peerDependenciesMeta?.[name]).toEqual({ optional: true })
      expect(manifest.devDependencies[name]).toBe(version)
      expect(manifest.dependencies?.[name]).toBeUndefined()
    }

    expect(manifest.peerDependencies.convex).toBe(supportedPeerRanges.convex)
    expect(manifest.devDependencies.convex).toBe(supportedDependencyTuple.convex)
    expect(manifest.dependencies?.convex).toBeUndefined()
    for (const dependencies of [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
    ]) {
      expect(dependencies?.kysely).toBeUndefined()
    }
    expect(manifest.dependencies?.['convex-helpers']).toBe(
      supportedDependencyTuple['convex-helpers'],
    )
    expect(manifest.peerDependencies['@convex-dev/better-auth']).toBeUndefined()
    expect(manifest.devDependencies['@convex-dev/better-auth']).toBeUndefined()
  })
})
