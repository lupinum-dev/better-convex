// Framework-free typed auth-client definition entry.
//
// Published as `better-convex-nuxt/auth-client`. This subpath contains ONLY the
// definition identity function and its types. It must not import Nuxt, Vue,
// `#imports`, browser globals, or server globals; the only imports are
// type-only Better Auth types, which carry no runtime coupling
// (enforced by the `auth-client-no-runtime-deps` boundary rule and the
// `./auth-client` packed-entry purity guard).
//
// The typing mechanism here is proven from the real packed entry by
// `test/fixtures/auth-client-typing`: `InferRegisteredConvexAuthClient` feeds
// the resolved options to `VueAuthClient<Options>` WITHOUT re-intersecting the full
// `BetterAuthClientOptions`. That broad type carries an optional
// `plugins?: BetterAuthClientPlugin[]`; intersecting it collapses the resolved
// plugin tuple and silently degrades plugin-method inference to `any`. Base
// options are carried only via `Omit<BetterAuthClientOptions, ...>`. Base and
// registered client types are inferred from `better-auth/vue` (the runtime
// instantiation entry), not `better-auth/client`, so session/plugin shapes
// cannot drift.

import type { BetterAuthClientOptions } from 'better-auth/client'
import type { VueAuthClient } from 'better-auth/vue'

import type { AuthClientPlugins, ConvexAuthClientDefinitionOptions } from './definition-types'

export type { IntegratedAuthClient } from '../utils/integrated-auth-client'

/** A frozen, framework-free description of the consumer's client (no instance). */
export interface ConvexAuthClientDefinition<Plugins extends AuthClientPlugins> {
  readonly options: ConvexAuthClientDefinitionOptions<Plugins>
}

/**
 * Capture the typed shape of a Convex Better Auth client without instantiating
 * one. The `const` plugins generic preserves the tuple so plugin-method
 * inference survives into `InferRegisteredConvexAuthClient`.
 *
 * @example
 * ```ts
 * // app/convex-auth.ts — import your plugin clients (organizationClient,
 * // apiKeyClient) and defineConvexAuthClient, then:
 * export default defineConvexAuthClient({
 *   plugins: [organizationClient(), apiKeyClient()],
 * })
 * ```
 */
export function defineConvexAuthClient<const Plugins extends AuthClientPlugins = []>(
  options: ConvexAuthClientDefinitionOptions<Plugins> = {},
): ConvexAuthClientDefinition<Plugins> {
  return Object.freeze({ options: Object.freeze(options) })
}

/**
 * Augmentable registry . The module-generated type template (produced
 * by `src/module.ts` via Nuxt Kit `addTypeTemplate`) adds a `definition` member
 * whose type is `typeof` the resolved consumer definition:
 *
 * ```ts
 * declare module 'better-convex-nuxt/auth-client' {
 *   interface ConvexAuthClientRegistry {
 *     definition: typeof definition
 *   }
 * }
 * ```
 *
 * Augmenting this exact module (where the interface is declared) is required:
 * `InferRegisteredConvexAuthClient` below reads this interface, and a
 * cross-module re-export augmentation would not merge into it. The packed
 * auth-client typing fixture covers this boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentionally empty; the generated type template augments it with `definition`.
export interface ConvexAuthClientRegistry {}

/**
 * Better Auth's `plugins` option is a MUTABLE array; a definition holds a
 * readonly tuple, so strip `readonly` when spreading into resolved options.
 */
type MutablePlugins<P extends readonly unknown[]> = {
  -readonly [I in keyof P]: P[I]
}

/** Extract the plugins tuple from a registered definition VALUE (never `ReturnType<typeof factory>`). */
type PluginsOf<D> = D extends ConvexAuthClientDefinition<infer P> ? P : []

/**
 * The options actually handed to `createAuthClient`: base options via `Omit`
 * plus the module-owned `baseURL` and the consumer plugin tuple.
 * tuple. The full `BetterAuthClientOptions` is deliberately NOT re-intersected.
 */
type ResolvedOptions<Plugins extends AuthClientPlugins> = Omit<
  BetterAuthClientOptions,
  'baseURL' | 'plugins'
> & {
  baseURL: string
  plugins: [...MutablePlugins<Plugins>]
}

/** The inferred client type for the library-owned options with no consumer plugins. */
export type BaseAuthClient = VueAuthClient<ResolvedOptions<[]>>

/**
 * The registered raw Better Auth shape used to infer the integrated client.
 * Exposes plugin methods when a definition is registered; falls back to the
 * base Better Auth client type otherwise.
 */
export type InferRegisteredConvexAuthClient = ConvexAuthClientRegistry extends {
  definition: infer D
}
  ? VueAuthClient<ResolvedOptions<PluginsOf<D>>>
  : BaseAuthClient
