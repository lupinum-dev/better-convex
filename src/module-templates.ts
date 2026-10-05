export function getMissingConvexApiTemplateContents(): string {
  return `
type MissingConvexGeneratedApi = {
  /**
   * The generated Convex API was not found.
   * Run \`pnpm exec better-convex convex dev\` or \`pnpm exec better-convex convex codegen\` to create \`convex/_generated/api\`.
   */
  readonly __betterConvexNuxtError: 'Missing generated Convex API. Run pnpm exec better-convex convex dev or pnpm exec better-convex convex codegen.'
}

function createMissingConvexApiProxy(path: string[]): MissingConvexGeneratedApi {
  return new Proxy({} as MissingConvexGeneratedApi, {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined
      if (prop === '__betterConvexNuxtError') {
        return 'Missing generated Convex API. Run pnpm exec better-convex convex dev or pnpm exec better-convex convex codegen.'
      }
      const accessPath = [...path, String(prop)].join('.')
      throw new Error(
        '[better-convex-nuxt] #convex/api points to a placeholder because convex/_generated/api was not found. ' +
          'Run \`pnpm exec better-convex convex dev\` or \`pnpm exec better-convex convex codegen\` to generate your Convex API. ' +
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
     * Route protection powered by better-convex-nuxt.
     * \`true\` = require auth (default redirect), object = custom sign-in redirect,
     * \`'guest'\` = signed-out visitors only, \`false\` = public even when
     * \`convex.auth.routes\` is \`'protected'\`. Omitted follows \`convex.auth.routes\`.
     */
    convexAuth?: ConvexAuthPageMeta
  }
}

export {}
`
}

/**
 * `#convex/client-activation`: how `useConvexActivation()` starts the browser
 * runtime. Eager builds install the client plugin and export no loader. The
 * on-demand loader is a dynamic import behind `import.meta.client`, so the
 * server bundle drops it and the browser downloads it only on activation.
 * `#convex/browser-runtime` is an alias to the build's client plugin module.
 */
export function getClientActivationTemplateContents(connect: 'eager' | 'on-demand'): string {
  if (connect === 'eager') {
    return `export const connect = 'eager'\nexport const loadBrowserRuntime = null\n`
  }
  return [
    `export const connect = 'on-demand'`,
    `export const loadBrowserRuntime = import.meta.client`,
    `  ? () => import('#convex/browser-runtime').then((m) => m.setupConvexBrowserRuntime)`,
    `  : null`,
    ``,
  ].join('\n')
}

/** Types for the `convex: { ssrAuth }` Nitro route rule (auth builds only). */
export function getRouteRulesTypeTemplateContents(ssrAuthTypeImport: string): string {
  const specifier = JSON.stringify(ssrAuthTypeImport)
  const augmentation = [
    `  interface NitroRouteConfig {`,
    `    convex?: ConvexRouteRules`,
    `  }`,
    `  interface NitroRouteRules {`,
    `    convex?: ConvexRouteRules`,
    `  }`,
  ].join('\n')
  return [
    `import type { ConvexRouteRules } from ${specifier}`,
    ``,
    `declare module 'nitropack' {`,
    augmentation,
    `}`,
    `declare module 'nitropack/types' {`,
    augmentation,
    `}`,
    ``,
    `export {}`,
    ``,
  ].join('\n')
}

/** Declaration of `#convex/client-activation` for every build mode. */
export function getClientActivationTypeTemplateContents(): string {
  return [
    `declare module '#convex/client-activation' {`,
    `  export const connect: 'eager' | 'on-demand'`,
    `  export const loadBrowserRuntime:`,
    `    | (() => Promise<(nuxtApp: import('#app').NuxtApp) => void>)`,
    `    | null`,
    `}`,
    ``,
  ].join('\n')
}
