// Public typed auth-client contract with unit-level compile and runtime
// checks. The packed consumer contract (published `/auth-client` entry + a real
// module-generated registry, both the plugin-typed and empty-fallback programs)
// lives in `test/fixtures/auth-client-typing/`; this file pins the same typing
// mechanism against the source entry plus the runtime validation helper.

import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import type { BetterAuthClientOptions, BetterAuthClientPlugin } from 'better-auth/client'
import type { organizationClient } from 'better-auth/client/plugins'
import { organizationClient as organizationClientRuntime } from 'better-auth/client/plugins'
import { describe, expect, it } from 'vitest'

import {
  defineConvexAuthClient,
  type BaseAuthClient,
  type ConvexAuthClientDefinition,
  type InferRegisteredConvexAuthClient,
  type IntegratedAuthClient,
} from '../../src/runtime/auth-client'
import {
  ConvexAuthClientDefinitionError,
  validateConvexAuthClientDefinition,
} from '../../src/runtime/auth/validate-auth-client-definition'

// --- tiny type-assertion kit ---------------------------------------------------
type IsAny<T> = 0 extends 1 & T ? true : false
type Expect<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

// -----------------------------------------------------------------------------
// Register an organization-plugin definition in the GLOBAL registry for this program.
// `InferRegisteredConvexAuthClient` reads the registry; `BaseAuthClient` is the
// no-plugin client and is independent of it, so one TypeScript program checks
// both the plugin-typed and base-fallback paths. The packed fixture checks the
// true empty-registry fallback in a separate program.
// -----------------------------------------------------------------------------
const _organizationDefinition = defineConvexAuthClient({ plugins: [organizationClientRuntime()] })

declare module '../../src/runtime/auth-client' {
  interface ConvexAuthClientRegistry {
    definition: typeof _organizationDefinition
  }
}

// (a) The registered organization definition exposes typed plugin methods.
declare const registeredClient: InferRegisteredConvexAuthClient | null
declare const integratedClient: IntegratedAuthClient<InferRegisteredConvexAuthClient>
export function _assertPluginClient() {
  if (!registeredClient) return

  type ListFn = typeof registeredClient.organization.list
  type _listNotAny = Expect<Equal<IsAny<ListFn>, false>>
  void registeredClient.organization.list()
}

export function _assertIntegratedClient() {
  const session = integratedClient.useSession()
  const list = integratedClient.organization.list()
  void session.value.isPending
  void list.then
  // @ts-expect-error the integrated client has no raw fetch escape.
  void integratedClient.$fetch
  // @ts-expect-error the integrated client has no raw store escape.
  void integratedClient.$store
  // @ts-expect-error the integrated client cannot hydrate provider state.
  void integratedClient.hydrateSession
}

// (b) The base fallback client exposes only the base surface — organization is absent.
type _baseNotAny = Expect<Equal<IsAny<BaseAuthClient>, false>>
type _baseHasNoOrganization = Expect<
  Equal<'organization' extends keyof BaseAuthClient ? true : false, false>
>
declare const baseClient: BaseAuthClient
export function _assertBaseClient() {
  // Base client still carries the core Better Auth surface.
  const _signIn = baseClient.signIn
  void _signIn
  // @ts-expect-error the base client has no apiKey namespace.
  baseClient.organization.list()
}

// (c) The definition generic preserves the plugin tuple, and the merged
//     [convexPlugin, ...consumerPlugins] array is MUTABLE (spread of a readonly
//     tuple) so it stays assignable to better-auth's mutable `plugins` slot.
type OrganizationPlugin = ReturnType<typeof organizationClient>
type ConvexPluginStandIn = BetterAuthClientPlugin
type PluginsSlot = NonNullable<BetterAuthClientOptions['plugins']>
type MergedMutable = [ConvexPluginStandIn, OrganizationPlugin]
type _mergedAssignable = Expect<MergedMutable extends PluginsSlot ? true : false>
// A readonly tuple must NOT be silently accepted where the mutable array is
// required — the spread (MutablePlugins) is what makes it mutable.
type _readonlyRejected = Expect<
  Equal<
    readonly [ConvexPluginStandIn, OrganizationPlugin] extends PluginsSlot ? true : false,
    false
  >
>
// The definition holds the tuple; extracting it back yields the same tuple.
type _defTuple = Expect<
  typeof _organizationDefinition extends ConvexAuthClientDefinition<infer P>
    ? P extends readonly [OrganizationPlugin]
      ? true
      : false
    : false
>

describe('defineConvexAuthClient', () => {
  it('returns a frozen definition wrapping frozen options (no client instance)', () => {
    const definition = defineConvexAuthClient({ plugins: [] })
    expect(Object.isFrozen(definition)).toBe(true)
    expect(Object.isFrozen(definition.options)).toBe(true)
    expect(definition.options.plugins).toEqual([])
    // No instantiation: the definition is a plain data descriptor.
    expect(Object.keys(definition)).toEqual(['options'])
  })

  it('defaults to an empty definition when called with no arguments', () => {
    const definition = defineConvexAuthClient()
    expect(definition.options).toEqual({})
    // Type: an empty definition is ConvexAuthClientDefinition<[]>.
    const _typed: ConvexAuthClientDefinition<[]> = definition
    void _typed
  })

  it('preserves the plugin tuple through a mutable merged array', () => {
    const definition = defineConvexAuthClient({ plugins: [organizationClientRuntime()] })
    const convexStandIn = { id: 'convex' } as unknown as BetterAuthClientPlugin
    // The resolved plugins array is [convexPlugin, ...consumerPlugins] — a
    // MUTABLE array, so `push` works after the merge (tuple mutability is pinned
    // at the type level by `_mergedAssignable` / `_readonlyRejected` below).
    const consumerPlugins = Array.from(definition.options.plugins ?? [])
    const merged: BetterAuthClientPlugin[] = [convexStandIn, ...consumerPlugins]
    merged.push({ id: 'later' } as unknown as BetterAuthClientPlugin)
    expect(merged).toHaveLength(3)
    expect(merged[0]?.id).toBe('convex')
  })
})

describe('validateConvexAuthClientDefinition', () => {
  const ok = (options: Record<string, unknown>) => validateConvexAuthClientDefinition({ options })

  it('accepts a valid definition and returns its options', () => {
    const options = { plugins: [{ id: 'organization' }] }
    expect(ok(options)).toBe(options)
    expect(validateConvexAuthClientDefinition({ options: {} })).toEqual({})

    const oauthDefinition = defineConvexAuthClient({ plugins: [oauthProviderClient()] })
    expect(validateConvexAuthClientDefinition(oauthDefinition)).toBe(oauthDefinition.options)
  })

  it('rejects a non-definition value', () => {
    expect(() => validateConvexAuthClientDefinition(null)).toThrow(ConvexAuthClientDefinitionError)
    expect(() => validateConvexAuthClientDefinition({})).toThrow(ConvexAuthClientDefinitionError)
  })

  it.each(['baseURL', 'basePath', 'fetchOptions'])('rejects the module-owned own key %s', (key) => {
    expect(() => ok({ [key]: 'x' })).toThrow(ConvexAuthClientDefinitionError)
  })

  it('rejects a non-array plugins value', () => {
    expect(() => ok({ plugins: {} })).toThrow(ConvexAuthClientDefinitionError)
    expect(() => ok({ plugins: 'nope' })).toThrow(ConvexAuthClientDefinitionError)
  })

  it('rejects a malformed plugin (missing string id)', () => {
    expect(() => ok({ plugins: [{}] })).toThrow(ConvexAuthClientDefinitionError)
    expect(() => ok({ plugins: [{ id: 123 }] })).toThrow(ConvexAuthClientDefinitionError)
    expect(() => ok({ plugins: [null] })).toThrow(ConvexAuthClientDefinitionError)
  })

  it('rejects a consumer plugin that reuses the reserved convex id', () => {
    expect(() => ok({ plugins: [{ id: 'convex' }] })).toThrow(ConvexAuthClientDefinitionError)
    expect(() => ok({ plugins: [{ id: 'organization' }, { id: 'convex' }] })).toThrow(
      /reserved id `convex`/,
    )
  })

  it('rejects a plugin outside the reviewed server capability profile', () => {
    expect(() => ok({ plugins: [{ id: 'api-key' }] })).toThrow(/unsupported id `api-key`/)
  })

  it('rejects a duplicated reviewed capability', () => {
    expect(() => ok({ plugins: [{ id: 'organization' }, { id: 'organization' }] })).toThrow(
      /duplicates the already configured capability `organization`/,
    )
  })
})
