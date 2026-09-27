interface NuxtAliasRegistrationTarget {
  options: {
    alias: Record<string, string>
  }
  hook: (
    name: 'prepare:types',
    callback: (options: {
      tsConfig: { compilerOptions?: { paths?: Record<string, string[]> } }
    }) => void | Promise<void>,
  ) => unknown
}

interface ModuleAliasResolver {
  resolve: (...path: string[]) => string
}

export function registerConvexAliases(options: {
  nuxt: NuxtAliasRegistrationTarget
  resolver: ModuleAliasResolver
  convexApiAlias: string
}): void {
  const { nuxt, resolver, convexApiAlias } = options
  const convexServerAlias = resolver.resolve('./runtime/server/index')

  nuxt.options.alias['#convex/api'] = convexApiAlias
  nuxt.options.alias['#convex/server'] = convexServerAlias

  nuxt.hook('prepare:types', (opts) => {
    opts.tsConfig.compilerOptions ??= {}
    opts.tsConfig.compilerOptions.paths ??= {}
    opts.tsConfig.compilerOptions.paths['#convex/api'] = [convexApiAlias]
    opts.tsConfig.compilerOptions.paths['#convex/server'] = [convexServerAlias]
  })
}
