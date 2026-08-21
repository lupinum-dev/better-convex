// Typed-client contract checked by `nuxi typecheck` against the packed
// `@lupinum/better-convex-nuxt/better-auth/client` entry with the MODULE-GENERATED registry
// (`.nuxt/types/better-convex auth schema-client.d.ts`, produced by `nuxi prepare`
// from this app's `convex-auth.ts`) active.
import type {
  BaseAuthClient,
  InferRegisteredConvexAuthClient,
  IntegratedAuthClient,
} from '@lupinum/better-convex-nuxt/better-auth/client'
import type { BetterAuthClientOptions, BetterAuthClientPlugin } from 'better-auth/client'
import type { organizationClient } from 'better-auth/client/plugins'

// --- tiny type-assertion kit ---
type IsAny<T> = 0 extends 1 & T ? true : false
type Expect<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

// The current implementation shape, proved end-to-end through the LIVE composable (not a bare
// `declare const`): `useConvexAuth().client` is narrowed to
// the integrated form of `InferRegisteredConvexAuthClient | null` by the
// module-generated registry.
const { client } = useConvexAuth()
type _clientIsRegisteredType = Expect<
  Equal<typeof client, IntegratedAuthClient<InferRegisteredConvexAuthClient> | null>
>

// -----------------------------------------------------------------------------
// (a) The registered organization definition exposes typed plugin methods.
// -----------------------------------------------------------------------------
export function assertPluginClient() {
  if (!client) return

  type ListFn = typeof client.organization.list
  type _listNotAny = Expect<Equal<IsAny<ListFn>, false>>
  void client.organization.list()

  // The integrated contract removes all direct provider state/fetch bypasses.
  // @ts-expect-error direct Better Fetch access is intentionally hidden.
  client.$fetch
  // @ts-expect-error direct store access is intentionally hidden.
  client.$store
  // @ts-expect-error direct session hydration is intentionally hidden.
  client.hydrateSession
}

// -----------------------------------------------------------------------------
// (c) The definition generic preserves plugin tuples through a MUTABLE merged
//     plugins array (spread of a readonly tuple). better-auth's `plugins` option
//     is a mutable array; [convexPlugin, ...consumerPlugins] must stay assignable.
// -----------------------------------------------------------------------------
type OrganizationPlugin = ReturnType<typeof organizationClient>
type ConvexPluginStandIn = BetterAuthClientPlugin
type MergedMutable = [ConvexPluginStandIn, OrganizationPlugin]
type PluginsSlot = NonNullable<BetterAuthClientOptions['plugins']>
type _mergedAssignable = Expect<MergedMutable extends PluginsSlot ? true : false>
type _readonlyRejected = Expect<
  Equal<
    readonly [ConvexPluginStandIn, OrganizationPlugin] extends PluginsSlot ? true : false,
    false
  >
>

// Sanity: the base (no-plugin) client is a strict structural subset — it does
// not carry the organization namespace (the full negative assertion lives in base-fallback/).
type _baseHasNoOrganization = Expect<
  Equal<'organization' extends keyof BaseAuthClient ? true : false, false>
>
