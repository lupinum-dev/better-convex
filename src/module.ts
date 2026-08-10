import { existsSync } from 'node:fs'

import {
  defineNuxtModule,
  addPlugin,
  createResolver,
  addTemplate,
  addTypeTemplate,
  addImports,
  addServerHandler,
  addServerImports,
  addServerPlugin,
  addRouteMiddleware,
  resolvePath,
  useLogger,
} from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import { defu } from 'defu'

import { registerConvexAliases } from './module-aliases'
import {
  authAutoImports,
  composableAutoImports,
  serverAutoImports,
  type ModuleImportRegistration,
} from './module-api-surface'
import {
  getMissingConvexApiTemplateContents,
  getTypeAugmentationTemplateContents,
} from './module-templates'
import { getPackedRuntimeFingerprint } from './runtime/shared/release-fingerprint'
import {
  normalizeConvexAuthConfig,
  isConvexAuthEnabled,
  type ConvexAuthOptions,
} from './runtime/utils/auth-config'
import { CONVEX_MODULE_DEFAULTS } from './runtime/utils/config-defaults'
import { getSiteUrlResolutionHint, resolveConvexSiteUrl } from './runtime/utils/convex-config'
import type { LogLevel } from './runtime/utils/logger'
import { normalizeConvexDeploymentUrl, normalizeConvexSiteUrl } from './runtime/utils/site-url'

const releaseRuntimeFingerprint = getPackedRuntimeFingerprint()

// Re-exported public types . The root default export is the module;
// stable public types are re-exported here. Do not export the raw
// `ConvexPublicRuntimeConfig` — consumers read `useConvexConfig()`.
export type { ConvexAuthOptions } from './runtime/utils/auth-config'
export type { ConvexAuthMode, ConvexAuthStatus } from './runtime/utils/auth-status'
export type {
  ConvexCallStatus,
  ConvexClientHandle,
  OptimisticUpdate,
  UseConvexCall,
} from 'better-convex-vue'
export type { ConvexRuntimeConfig } from './runtime/utils/runtime-config'
export type { UseConvexAuthReturn } from './runtime/utils/auth-contract'
export type {
  UploadProgressInfo,
  UploadStatus,
  UploadUrlMutation,
  UseConvexFileUploadOptions,
  UseConvexFileUploadReturn,
} from './runtime/composables/useConvexFileUpload'
export type { UseConvexMutationOptions } from './runtime/composables/useConvexMutation'
export type {
  NuxtConvexPaginatedQuery,
  UseConvexPaginatedQueryState,
} from './runtime/composables/useConvexPaginatedQuery'
export type { NuxtConvexQuery, UseConvexQueryState } from './runtime/composables/useConvexQuery'

/** Per-call query options for the Nuxt composable, including its SSR policy. */
export type UseConvexQueryOptions =
  import('./runtime/composables/useConvexQuery').UseNuxtConvexQueryOptions

/** The exact rest parameters accepted by Nuxt's `useConvexQuery`. */
export type UseConvexQueryParameters<
  Query extends import('convex/server').FunctionReference<'query'>,
  Options extends UseConvexQueryOptions = UseConvexQueryOptions,
> = import('better-convex-vue').UseConvexQueryParameters<Query, Options>

/** Per-call pagination options for the Nuxt composable, including its SSR policy. */
export type UseConvexPaginatedQueryOptions =
  import('./runtime/composables/useConvexPaginatedQuery').UseNuxtConvexPaginatedQueryOptions

const logger = useLogger('better-convex-nuxt')

function hasGeneratedConvexApi(aliasPath: string): boolean {
  return (
    existsSync(aliasPath) ||
    existsSync(`${aliasPath}.ts`) ||
    existsSync(`${aliasPath}.js`) ||
    existsSync(`${aliasPath}.d.ts`)
  )
}

function resolveModuleImports(
  resolver: ReturnType<typeof createResolver>,
  imports: readonly ModuleImportRegistration[],
): ModuleImportRegistration[] {
  return imports.map((entry) => ({
    name: entry.name,
    from: resolver.resolve(entry.from),
  }))
}

/** The one convention filename searched in the host application's `srcDir`. */
const AUTH_CLIENT_CONVENTION_FILENAME = 'convex-auth.ts'

/**
 * Resolve the single auth-client definition module ("Module option").
 *
 * Resolution order is exact:
 *   1. explicit `auth.client` — resolved with Nuxt Kit `resolvePath` using the
 *      host `rootDir` as `cwd` and the host `alias` table, and required to exist
 *      (configuration errors include the original specifier);
 *   2. `<srcDir>/convex-auth.ts` — the one convention filename, searched only in
 *      the host application's `srcDir` (layers/reusable modules always provide an
 *      already-resolved absolute path via explicit `auth.client`, so they are
 *      never convention-scanned);
 *   3. the built-in empty definition shipped with the module.
 */
async function resolveAuthClientDefinitionPath(
  authOptions: ConvexAuthOptions,
  nuxt: Nuxt,
  resolver: ReturnType<typeof createResolver>,
): Promise<string> {
  const explicit = typeof authOptions.client === 'string' ? authOptions.client.trim() : ''
  if (explicit) {
    const resolved = await resolvePath(explicit, {
      cwd: nuxt.options.rootDir,
      alias: nuxt.options.alias,
    })
    if (!existsSync(resolved)) {
      throw new Error(
        `[better-convex-nuxt] auth.client "${explicit}" could not be resolved to an existing file ` +
          `(resolved to "${resolved}"). Provide a path or alias to a module that default-exports a ` +
          `defineConvexAuthClient(...) definition.`,
      )
    }
    return resolved
  }

  const conventionPath = resolver.resolve(nuxt.options.srcDir, AUTH_CLIENT_CONVENTION_FILENAME)
  if (existsSync(conventionPath)) {
    return conventionPath
  }

  return resolver.resolve('./runtime/auth-client/empty-definition')
}

/**
 * Better Convex Nuxt module options .
 *
 * Omitted auth produces a Convex-only build. An object explicitly installs
 * authentication; `false` removes auth inherited from a Nuxt layer.
 */
export interface ModuleOptions {
  /** Convex deployment URL (WebSocket) - e.g., https://your-app.convex.cloud */
  url?: string
  /**
   * Convex site URL (HTTP Actions) - e.g., https://your-app.convex.site.
   * If not provided, automatically derived from `url`.
   */
  siteUrl?: string
  /**
   * Authentication installation. An object opts in; omission is off. `false`
   * is the explicit Nuxt-layer tombstone for inherited auth configuration.
   */
  auth?: false | ConvexAuthOptions
  /**
   * Enable module logging.
   * - false: No logs (production default)
   * - 'info': Simple logs for everyday use
   * - 'debug': Detailed logs with timing for deep debugging
   * @default false
   */
  logging?: LogLevel
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'better-convex-nuxt',
    configKey: 'convex',
    compatibility: {
      nuxt: '4.5.1',
    },
  },
  defaults: {
    url: process.env.NUXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL,
    siteUrl: process.env.NUXT_PUBLIC_CONVEX_SITE_URL || process.env.CONVEX_SITE_URL,
    // Auth is intentionally omitted: an ordinary Convex application has no
    // Better Auth build graph unless it opts in with an auth object.
    logging: CONVEX_MODULE_DEFAULTS.logging,
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const generatedConvexApiAlias = resolver.resolve(nuxt.options.rootDir, 'convex/_generated/api')
    const missingConvexApiTemplate = addTemplate({
      filename: 'better-convex-nuxt/convex-api-missing.ts',
      write: true,
      getContents: getMissingConvexApiTemplateContents,
    })
    const convexApiAlias = hasGeneratedConvexApi(generatedConvexApiAlias)
      ? generatedConvexApiAlias
      : missingConvexApiTemplate.dst

    const resolvedUrl = options.url ? normalizeConvexDeploymentUrl(options.url) : undefined

    const siteUrlResolution = resolveConvexSiteUrl({
      url: resolvedUrl,
      siteUrl: options.siteUrl,
    })
    const resolvedSiteUrl = siteUrlResolution.siteUrl

    if (resolvedSiteUrl) normalizeConvexSiteUrl(resolvedSiteUrl)

    // Single build-time auth resolution: one discriminated value drives every
    // plugin/handler/middleware registration decision (architecture invariant).
    const normalizedAuthConfig = normalizeConvexAuthConfig(options.auth)
    const isAuthEnabled = isConvexAuthEnabled(normalizedAuthConfig)

    if (isAuthEnabled && !resolvedSiteUrl) {
      logger.warn(
        `Authentication is enabled but no usable siteUrl was resolved. ${getSiteUrlResolutionHint(resolvedUrl)}`,
      )
    }

    // Public runtime config. Normalized auth build policy is materialized
    // internally; build-only client selection never enters runtime config.
    const convexConfig = {
      ...defu(nuxt.options.runtimeConfig.public.convex as Record<string, unknown> | undefined, {
        url: resolvedUrl || '',
        siteUrl: resolvedSiteUrl || '',
        logging: options.logging ?? CONVEX_MODULE_DEFAULTS.logging,
      }),
      // Auth is build policy, not a deploy-time/public runtime override.
      auth: normalizedAuthConfig,
    }
    nuxt.options.runtimeConfig.public.convex = convexConfig as never
    registerConvexAliases({ nuxt, resolver, convexApiAlias })
    addServerPlugin(resolver.resolve('./runtime/server/plugins/runtime-config'))
    if (releaseRuntimeFingerprint) {
      addServerHandler({
        route: '/api/_better-convex-nuxt/release-fingerprint',
        handler: resolver.resolve('./runtime/server/api/release-fingerprint'),
      })
    }

    // Exactly one browser-runtime plugin is installed. The auth-disabled entry
    // has no Better Auth imports; the auth-enabled entry constructs the same
    // Vue-owned runtime with the first-party provider adapter.
    if (!isAuthEnabled) addPlugin(resolver.resolve('./runtime/plugin.client'))

    // Universal ConvexCallError payload plugin . Registered on both
    // server and client with a negative order so the reviver is installed before
    // Nuxt parses the SSR payload. The framework-free `/errors` entry stays
    // unaware of Nuxt; this Nuxt-aware plugin bridges the two.
    addPlugin({
      src: resolver.resolve('./runtime/plugins/convex-call-error-payload'),
      mode: 'all',
      order: -50,
    })

    // 2. Auth-enabled-only plugins. When auth is disabled the module adds NO
    //    Better Auth client, engine, proxy handler, or middleware to the build
    //    graph (architecture invariant).
    if (isAuthEnabled) {
      // Typed auth-client definition plumbing . Resolve the single
      // definition module, expose it to the auth-enabled client plugin through
      // the `#convex/auth-client` virtual module, and generate the consumer type
      // registry so `useConvexAuth().client` is typed to the resolved plugins.
      //
      // `options.auth` is an object here (isAuthEnabled ⇒ `auth !== false`); the
      // build-only `auth.client` path is resolved for templates only and never
      // reaches `runtimeConfig` (it was excluded from `convexConfig` above).
      const authClientDefinitionPath = await resolveAuthClientDefinitionPath(
        options.auth as ConvexAuthOptions,
        nuxt,
        resolver,
      )

      // Re-export the resolved definition. Aliased as `#convex/auth-client`
      // (the module's established namespace), NOT `#build/*`: Nuxt's built-in
      // `#build` prefix resolves independently of this template destination.
      const authClientTemplate = addTemplate({
        filename: 'better-convex-nuxt/auth-client.mjs',
        write: true,
        getContents: () => `export { default } from ${JSON.stringify(authClientDefinitionPath)}\n`,
      })
      nuxt.options.alias['#convex/auth-client'] = authClientTemplate.dst

      // Register a declaration that augments the auth-client registry with the
      // resolved definition's type ("Generated type registry"). The
      // augmentation targets `better-convex-nuxt/auth-client` — the module where
      // `ConvexAuthClientRegistry` and `InferRegisteredConvexAuthClient` are
      // declared — so the inference reads the merged registry (covered by the
      // packed auth-client typing fixture). `addTypeTemplate` registers the
      // reference for us.
      addTypeTemplate({
        filename: 'types/better-convex-nuxt-auth-client.d.ts',
        getContents: () =>
          [
            `import type definition from ${JSON.stringify(authClientDefinitionPath)}`,
            ``,
            `declare module 'better-convex-nuxt/auth-client' {`,
            `  interface ConvexAuthClientRegistry {`,
            `    definition: typeof definition`,
            `  }`,
            `}`,
            ``,
          ].join('\n'),
      })

      // Make `#convex/auth-client` resolvable for the TypeScript program too, so
      // the auth-enabled client plugin's import typechecks in consumer projects.
      nuxt.hook('prepare:types', (opts) => {
        opts.tsConfig.compilerOptions ??= {}
        opts.tsConfig.compilerOptions.paths ??= {}
        opts.tsConfig.compilerOptions.paths['#convex/auth-client'] = [authClientTemplate.dst]
      })

      // Auth-enabled-only server plugin resolves SSR identity.
      addPlugin({
        src: resolver.resolve('./runtime/plugin.server'),
        mode: 'server',
      })

      // Auth-enabled-only client plugin creates the Better Auth client and engine.
      addPlugin({
        src: resolver.resolve('./runtime/plugin.auth.client'),
        mode: 'client',
      })

      addRouteMiddleware({
        name: 'convex-auth',
        path: resolver.resolve('./runtime/middleware/convex-auth.global'),
        global: true,
      })

      // Auth proxy: register both exact and wildcard routes so requests without a
      // trailing slash are not missed by the /** glob in Nitro.
      addServerHandler({
        route: '/api/auth',
        handler: resolver.resolve('./runtime/server/api/auth/[...]'),
      })
      addServerHandler({
        route: '/api/auth/jwks',
        handler: resolver.resolve('./runtime/server/api/auth/jwks'),
      })
      addServerHandler({
        route: '/api/auth/**',
        handler: resolver.resolve('./runtime/server/api/auth/[...]'),
      })
      addServerHandler({
        route: '/.well-known/oauth-authorization-server/api/auth',
        handler: resolver.resolve('./runtime/server/api/auth/authorization-server-metadata'),
      })

      // Auth-only page metadata. A no-auth build does not advertise a policy it
      // cannot execute.
      addTemplate({
        filename: 'types/better-convex-nuxt-auth.d.ts',
        getContents: () =>
          getTypeAugmentationTemplateContents(
            resolver.resolve('./runtime/utils/auth-route-protection'),
          ),
      })
      addImports(resolveModuleImports(resolver, authAutoImports))
    }

    // 3. Core composables are available in every build. Auth APIs are
    // registered only in the auth-enabled block above.
    addImports(resolveModuleImports(resolver, composableAutoImports))

    // 4. Auto-import server utilities.
    addServerImports(resolveModuleImports(resolver, serverAutoImports))

    // 5. Nuxt DevTools integration (dev mode only).
    if (nuxt.options.dev) {
      setupDevTools(nuxt, resolver)
    }
  },
})

/**
 * Setup Nuxt DevTools integration. Only called in dev mode.
 */
function setupDevTools(nuxt: Nuxt, resolver: ReturnType<typeof createResolver>): void {
  const devtoolsOutputPath = resolver.resolve('./runtime/devtools/ui/dist')
  nuxt.options.runtimeConfig.convexDevtoolsPath = devtoolsOutputPath

  ;(
    nuxt as Nuxt & {
      hook: (
        name: 'devtools:customTabs',
        cb: (tabs: Array<Record<string, unknown>>) => void,
      ) => void
    }
  ).hook('devtools:customTabs', (tabs) => {
    tabs.push({
      name: 'convex',
      title: 'Convex',
      icon: '/__convex_devtools__/convex-logo.svg',
      category: 'app',
      view: {
        type: 'iframe',
        src: '/__convex_devtools__',
        persistent: true,
      },
    })
  })

  addServerHandler({
    route: '/__convex_devtools__',
    handler: resolver.resolve('./runtime/devtools/server'),
  })
  addServerHandler({
    route: '/__convex_devtools__/**',
    handler: resolver.resolve('./runtime/devtools/server'),
  })

  logger.info('Nuxt DevTools integration enabled')
}
