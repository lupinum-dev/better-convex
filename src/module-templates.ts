export function getMissingConvexApiTemplateContents(): string {
  return `
type MissingConvexGeneratedApi = {
  /**
   * The generated Convex API was not found.
   * Run the file-bound Convex dev command or \`pnpm exec better-convex-nuxt-convex codegen\` to create \`convex/_generated/api\`.
   */
  readonly __betterConvexNuxtError: 'Missing generated Convex API. Run the file-bound Convex dev command or pnpm exec better-convex-nuxt-convex codegen.'
}

function createMissingConvexApiProxy(path: string[]): MissingConvexGeneratedApi {
  return new Proxy({} as MissingConvexGeneratedApi, {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined
      if (prop === '__betterConvexNuxtError') {
        return 'Missing generated Convex API. Run the file-bound Convex dev command or pnpm exec better-convex-nuxt-convex codegen.'
      }
      const accessPath = [...path, String(prop)].join('.')
      throw new Error(
        '[better-convex-nuxt] #convex/api points to a placeholder because convex/_generated/api was not found. ' +
          'Run the file-bound Convex dev command or \`pnpm exec better-convex-nuxt-convex codegen\` to generate your Convex API. ' +
          'Attempted to access ' + accessPath + '.',
      )
    },
  })
}

export const api = createMissingConvexApiProxy([])
export const internal = createMissingConvexApiProxy(['internal'])
export const components = createMissingConvexApiProxy(['components'])
`
}

export function getTypeAugmentationTemplateContents(authPageMetaTypeImport: string): string {
  const authPageMetaImportSpecifier = JSON.stringify(authPageMetaTypeImport)

  return `
import type { ConvexAuthPageMeta } from ${authPageMetaImportSpecifier}

// Consumers use the stable \`useConvex()\` handle and auth composables instead
// of raw replaceable clients. Only route-protection page metadata needs a
// generated type augmentation.
declare module '#app' {
  interface PageMeta {
    /**
     * Opt-in route protection powered by better-convex-nuxt.
     * true = require auth (default redirect), object = custom redirect.
     */
    convexAuth?: ConvexAuthPageMeta
  }
}

export {}
`
}
