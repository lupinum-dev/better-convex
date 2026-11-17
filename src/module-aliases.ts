interface NuxtAliasRegistrationTarget {
  options: {
    alias: Record<string, string>
  }
}

interface ModuleAliasResolver {
  resolve: (...path: string[]) => string
}

/**
 * Registers the `#convex/*` aliases. Nuxt also writes each alias into the generated tsconfig
 * `paths` (app and server), so no `prepare:types` hook is needed.
 */
export function registerConvexAliases(options: {
  nuxt: NuxtAliasRegistrationTarget
  resolver: ModuleAliasResolver
  convexApiAlias: string
  convexDataModelAlias: string
}): void {
  const { nuxt, resolver, convexApiAlias, convexDataModelAlias } = options

  nuxt.options.alias['#convex/api'] = convexApiAlias
  // Types only: Convex generates `dataModel.d.ts` and no JavaScript file, so app code imports it
  // with `import type`.
  nuxt.options.alias['#convex/dataModel'] = convexDataModelAlias
  nuxt.options.alias['#convex/server'] = resolver.resolve('./runtime/server/index')
}
