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
    expect(autoImportNames).toContain('useConvexForm')
    expect(composableAutoImports).toContainEqual({
      name: 'useConvexAttachment',
      from: './runtime/composables/useConvexAttachment',
    })
    expect(autoImportNames).not.toContain('useConvexUser')
    expect(autoImportNames).not.toContain('defineSharedConvexQuery')
    expect(autoImportNames).not.toContain('useConvexStorageUrl')
    expect(autoImportNames).not.toContain('useConvexUploadQueue')
    expect(autoImportNames).not.toContain('updateQuery')
    expect(autoImportNames.size).toBe(composableAutoImports.length + authAutoImports.length)
  })

  it('exposes only the request-bound server caller as a Nitro auto-import', () => {
    expect(serverAutoImports).toEqual([
      {
        name: 'serverConvex',
        from: './runtime/server/utils/server-convex-caller',
      },
    ])
  })

  it('registers the #convex runtime and type aliases', () => {
    let prepareTypes:
      | ((options: {
          references: Array<{ path: string }>
          tsConfig: { compilerOptions?: { paths?: Record<string, string[]> } }
        }) => void)
      | undefined
    const nuxt = {
      options: {
        alias: {},
        buildDir: '/app/.nuxt',
      },
      hook: (name: 'prepare:types', callback: NonNullable<typeof prepareTypes>) => {
        expect(name).toBe('prepare:types')
        prepareTypes = callback
      },
    }
    const resolver = {
      resolve: (...parts: string[]) => parts.join('/'),
    }
    const tsConfigOptions = {
      references: [] as Array<{ path: string }>,
      tsConfig: {},
    }

    registerConvexAliases({
      nuxt,
      resolver,
      convexApiAlias: '/app/convex/_generated/api',
    })
    if (!prepareTypes) {
      throw new Error('Expected prepare:types hook to be registered')
    }
    prepareTypes(tsConfigOptions)

    expect(nuxt.options.alias).toEqual({
      '#convex/api': '/app/convex/_generated/api',
      '#convex/server': './runtime/server/index',
    })
    expect(tsConfigOptions).toEqual({
      references: [{ path: '/app/.nuxt/types/better-convex-nuxt.d.ts' }],
      tsConfig: {
        compilerOptions: {
          paths: {
            '#convex/api': ['/app/convex/_generated/api'],
            '#convex/server': ['./runtime/server/index'],
          },
        },
      },
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
