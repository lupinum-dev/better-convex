// Typed-client contract checked by `nuxi typecheck` against the packed
// `better-convex-nuxt/auth-client` entry with the MODULE-GENERATED registry
// (`.nuxt/types/better-convex-nuxt-auth-client.d.ts`, produced by `nuxi prepare`
// from this app's `convex-auth.ts`) active.
import type { apiKeyClient } from '@better-auth/api-key/client'
import type { BetterAuthClientOptions, BetterAuthClientPlugin } from 'better-auth/client'
import type {
  BaseAuthClient,
  InferRegisteredConvexAuthClient,
  IntegratedAuthClient,
} from 'better-convex-nuxt/auth-client'

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
// (a) The registered apiKey-plugin definition makes the narrowed non-null client
//     expose apiKey.create with correct parameter/return types (not `any`).
// -----------------------------------------------------------------------------
export function assertPluginClient() {
  if (!client) return

  type CreateFn = typeof client.apiKey.create
  type _createNotAny = Expect<Equal<IsAny<CreateFn>, false>>

  const created = client.apiKey.create({
    name: 'release-gate-key',
    expiresIn: 60 * 60 * 24,
    metadata: { scope: 'gate' },
  })
  created.then((res) => {
    if (res.data) {
      const id: string = res.data.id
      const key: string = res.data.key
      void id
      void key
    }
  })

  // Params are typed (not any): an unknown field is rejected.
  // @ts-expect-error `notAField` is not part of apiKey.create input.
  client.apiKey.create({ name: 'x', notAField: true })

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
type ApiKeyPlugin = ReturnType<typeof apiKeyClient>
type ConvexPluginStandIn = BetterAuthClientPlugin
type MergedMutable = [ConvexPluginStandIn, ApiKeyPlugin]
type PluginsSlot = NonNullable<BetterAuthClientOptions['plugins']>
type _mergedAssignable = Expect<MergedMutable extends PluginsSlot ? true : false>
type _readonlyRejected = Expect<
  Equal<readonly [ConvexPluginStandIn, ApiKeyPlugin] extends PluginsSlot ? true : false, false>
>

// Sanity: the base (no-plugin) client is a strict structural subset — it does
// not carry the apiKey namespace (the full negative assertion lives in base-fallback/).
type _baseHasNoApiKey = Expect<Equal<'apiKey' extends keyof BaseAuthClient ? true : false, false>>
