import { describe, expect, it } from 'vitest'

import { registerConvexAliases } from '../../src/module-aliases'
import {
  authAutoImports,
  composableAutoImports,
  serverAutoImports,
} from '../../src/module-api-surface'
import {
  getMissingConvexApiTemplateContents,
  getTypeAugmentationTemplateContents,
} from '../../src/module-templates'

describe('module auto-import surface', () => {
  it('includes stable public composable auto-imports', () => {
    const autoImportNames = new Set(
      [...composableAutoImports, ...authAutoImports].map((entry) => entry.name),
    )

    expect(autoImportNames).toContain('useConvexAuth')
    expect(authAutoImports).toContainEqual({
      name: 'useConvexAuthReturnTo',
      from: './runtime/composables/useConvexAuthReturnTo',
    })
    expect(authAutoImports).toContainEqual({
      name: 'normalizeLocalRedirectPath',
      from: './runtime/utils/auth-route-protection',
    })
    expect(autoImportNames).toContain('useConvexForm')
    expect(autoImportNames).not.toContain('useConvexOperation')
    expect(composableAutoImports).toContainEqual({
      name: 'useConvexAttachment',
      from: './runtime/composables/useConvexAttachment',
    })
    expect(composableAutoImports).toContainEqual({
      name: 'useConvexActivation',
      from: './runtime/composables/useConvexActivation',
    })
    expect(autoImportNames).not.toContain('useConvexUser')
    expect(autoImportNames).not.toContain('defineSharedConvexQuery')
    expect(autoImportNames).not.toContain('useConvexStorageUrl')
    expect(autoImportNames).not.toContain('useConvexUploadQueue')
    expect(autoImportNames).not.toContain('updateQuery')
    expect(autoImportNames.size).toBe(composableAutoImports.length + authAutoImports.length)
  })

  it('exposes the request-bound server caller and user helpers as Nitro auto-imports', () => {
    expect(serverAutoImports).toEqual([
      {
        name: 'serverConvex',
        from: './runtime/server/utils/server-convex-caller',
      },
      { name: 'getConvexUser', from: './runtime/server/utils/convex-user' },
      { name: 'requireConvexUser', from: './runtime/server/utils/convex-user' },
      { name: 'toConvexH3Error', from: './runtime/server/utils/h3-error' },
    ])
  })

  // Catches a moved or renamed alias target: consumer imports of `#convex/api` and
  // `#convex/server` would stop resolving (Nuxt derives the tsconfig paths from these aliases).
  it('registers the #convex runtime aliases', () => {
    const nuxt = { options: { alias: {} } }
    const resolver = {
      resolve: (...parts: string[]) => parts.join('/'),
    }

    registerConvexAliases({
      nuxt,
      resolver,
      convexApiAlias: '/app/convex/_generated/api',
    })

    expect(nuxt.options.alias).toEqual({
      '#convex/api': '/app/convex/_generated/api',
      '#convex/server': './runtime/server/index',
    })
    expect(getMissingConvexApiTemplateContents()).toContain('createMissingConvexApiProxy')
    const typeAugmentationTemplate = getTypeAugmentationTemplateContents(
      '/node_modules/@lupinum/better-convex-nuxt/dist/runtime/utils/auth-route-protection',
    )

    expect(typeAugmentationTemplate).toContain("declare module '#app'")
    expect(typeAugmentationTemplate).toContain('interface PageMeta')
    expect(typeAugmentationTemplate).toContain(
      'from "/node_modules/@lupinum/better-convex-nuxt/dist/runtime/utils/auth-route-protection"',
    )
    expect(typeAugmentationTemplate).toContain('convexAuth?: ConvexAuthPageMeta')
  })
})
