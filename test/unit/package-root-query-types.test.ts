import type {
  ConvexQueryArgs as VueConvexQueryArgs,
  PaginatedQueryArgs as VuePaginatedQueryArgs,
  PaginatedQueryItem as VuePaginatedQueryItem,
  UseConvexActionReturn as VueUseConvexActionReturn,
  UseConvexConnectionStateReturn as VueUseConvexConnectionStateReturn,
  UseConvexMutationReturn as VueUseConvexMutationReturn,
  UseConvexPaginatedQueryState as VueUseConvexPaginatedQueryState,
  UseConvexQueryOptions as VueUseConvexQueryOptions,
  UseConvexQueryState as VueUseConvexQueryState,
} from '@lupinum/better-convex-vue'
import type { FunctionReference, PaginationOptions, PaginationResult } from 'convex/server'
import { describe, expectTypeOf, it } from 'vitest'

import type {
  ConvexCallError,
  ConvexCallErrorCode,
  ConvexQueryArgs,
  ConvexRuntimeConfig,
  ConvexUser,
  NuxtConvexPaginatedQuery,
  NuxtConvexQuery,
  PaginatedQueryArgs,
  PaginatedQueryItem,
  UseConvexActionReturn,
  UseConvexConnectionStateReturn,
  UseConvexMutationReturn,
  UseConvexPaginatedQueryState,
  UseConvexQueryState,
  UseNuxtConvexPaginatedQueryOptions,
  UseNuxtConvexQueryOptions,
} from '../../src/module'
import type { ConvexCallError as ErrorsEntryConvexCallError } from '../../src/runtime/errors'

// A Vue name never carries the Nuxt meaning at the Nuxt root: vue-tsc fails if
// one of these is ever re-exported from `src/module`.
// @ts-expect-error -- the Nuxt root exports UseNuxtConvexQueryOptions instead.
type NotAtNuxtRootQueryOptions = import('../../src/module').UseConvexQueryOptions
// @ts-expect-error -- the Nuxt root exports UseNuxtConvexPaginatedQueryOptions instead.
type NotAtNuxtRootPaginatedOptions = import('../../src/module').UseConvexPaginatedQueryOptions

type PaginatedQuery = FunctionReference<
  'query',
  'public',
  { owner: string; paginationOpts: PaginationOptions },
  PaginationResult<{ id: string }>
>
type Mutation = FunctionReference<'mutation', 'public', { text: string }, string>
type Action = FunctionReference<'action', 'public', { to: string }, { ok: boolean }>

function readonlyContracts(
  queryOptions: UseNuxtConvexQueryOptions,
  paginationOptions: UseNuxtConvexPaginatedQueryOptions,
  queryState: UseConvexQueryState<string>,
) {
  // @ts-expect-error public options are immutable configuration values
  queryOptions.server = false
  // @ts-expect-error inherited Vue options remain readonly at the Nuxt root
  queryOptions.auth = 'none'
  // @ts-expect-error pagination options are immutable configuration values
  paginationOptions.initialNumItems = 10
  // @ts-expect-error state members cannot be replaced by consumers
  queryState.data = undefined
}

function removedModulePolicyContracts() {
  const defaults: import('../../src/module').ModuleOptions = {
    // @ts-expect-error query transport policy is per call
    defaults: { server: false },
  }
  const upload: import('../../src/module').ModuleOptions = {
    // @ts-expect-error upload queue policy was removed with the queue
    upload: { maxConcurrent: 3 },
  }
  const webSocket: import('../../src/module').ModuleOptions = {
    // @ts-expect-error a WebSocket constructor is not a serializable module option
    client: { webSocketConstructor: 'ws' },
  }
  return { defaults, upload, webSocket }
}

describe('Nuxt package-root query type contract', () => {
  it('gives each exported name exactly one meaning across Nuxt and Vue', () => {
    expectTypeOf<keyof ConvexRuntimeConfig>().toEqualTypeOf<'siteUrl' | 'url'>()
    // The Nuxt options extend the Vue ones under their own names.
    expectTypeOf<keyof UseNuxtConvexQueryOptions>().toEqualTypeOf<
      'auth' | 'keepPreviousData' | 'immediate' | 'lazy' | 'server'
    >()
    expectTypeOf<keyof UseNuxtConvexPaginatedQueryOptions>().toEqualTypeOf<
      | 'auth'
      | 'initialCursor'
      | 'initialNumItems'
      | 'keepPreviousData'
      | 'immediate'
      | 'lazy'
      | 'server'
    >()
    expectTypeOf<keyof VueUseConvexQueryOptions>().toEqualTypeOf<
      'auth' | 'keepPreviousData' | 'immediate'
    >()

    // Shared names are the Vue declarations, unchanged.
    expectTypeOf<ConvexQueryArgs<{ id: string }>>().toEqualTypeOf<
      VueConvexQueryArgs<{ id: string }>
    >()
    expectTypeOf<PaginatedQueryArgs<PaginatedQuery>>().toEqualTypeOf<
      VuePaginatedQueryArgs<PaginatedQuery>
    >()
    expectTypeOf<PaginatedQueryItem<PaginatedQuery>>().toEqualTypeOf<{ id: string }>()
    expectTypeOf<PaginatedQueryItem<PaginatedQuery>>().toEqualTypeOf<
      VuePaginatedQueryItem<PaginatedQuery>
    >()
    expectTypeOf<UseConvexQueryState<string>>().toEqualTypeOf<VueUseConvexQueryState<string>>()
    expectTypeOf<UseConvexPaginatedQueryState<string>>().toEqualTypeOf<
      VueUseConvexPaginatedQueryState<string>
    >()
    expectTypeOf<UseConvexMutationReturn<Mutation>>().toEqualTypeOf<
      VueUseConvexMutationReturn<Mutation>
    >()
    expectTypeOf<UseConvexActionReturn<Action>>().toEqualTypeOf<VueUseConvexActionReturn<Action>>()
    expectTypeOf<UseConvexConnectionStateReturn>().toEqualTypeOf<VueUseConvexConnectionStateReturn>()
    expectTypeOf<ConvexCallError>().toEqualTypeOf<ErrorsEntryConvexCallError>()
    expectTypeOf<'CLIENT_UNAVAILABLE'>().toMatchTypeOf<ConvexCallErrorCode>()
    expectTypeOf<'UNAUTHENTICATED'>().toMatchTypeOf<ConvexCallErrorCode>()
    expectTypeOf<ConvexUser['id']>().toEqualTypeOf<string>()

    expectTypeOf<NuxtConvexQuery<string>>().toMatchTypeOf<Promise<UseConvexQueryState<string>>>()
    expectTypeOf<NuxtConvexQuery<string>>().toMatchTypeOf<UseConvexQueryState<string>>()
    expectTypeOf<NuxtConvexPaginatedQuery<string>>().toMatchTypeOf<
      Promise<UseConvexPaginatedQueryState<string>>
    >()
    expectTypeOf<NuxtConvexPaginatedQuery<string>>().toMatchTypeOf<
      UseConvexPaginatedQueryState<string>
    >()
    expectTypeOf(readonlyContracts).toBeFunction()
    expectTypeOf(removedModulePolicyContracts).toBeFunction()
    // Unresolved imports are `any`; the @ts-expect-error lines above carry the check.
    expectTypeOf<NotAtNuxtRootQueryOptions>().toBeAny()
    expectTypeOf<NotAtNuxtRootPaginatedOptions>().toBeAny()
  })
})
