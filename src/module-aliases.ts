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
}): void {
  const { nuxt, resolver, convexApiAlias } = options

  nuxt.options.alias['#convex/api'] = convexApiAlias
  nuxt.options.alias['#convex/server'] = resolver.resolve('./runtime/server/index')
}
