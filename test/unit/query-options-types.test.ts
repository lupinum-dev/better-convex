import type { FunctionReference, PaginationOptions, PaginationResult } from 'convex/server'
import { describe, expectTypeOf, it } from 'vitest'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'

import type { DefineSharedConvexQueryOptions } from '../../src/runtime/composables/defineSharedConvexQuery'
import type {
  ConvexPaginatedQueryArgs,
  UseConvexPaginatedQueryOptions,
} from '../../src/runtime/composables/useConvexPaginatedQuery'
import type {
  ConvexQueryArgs,
  UseConvexQueryData,
  UseConvexQueryOptions,
} from '../../src/runtime/composables/useConvexQuery'
import type { ConvexCallError } from '../../src/runtime/errors'
import type { ConvexAuthMode } from '../../src/runtime/utils/auth-status'

// Type-only bindings for the composable functions. `typeof import(...)` is
// erased at compile time, so these never trigger a runtime `#imports` resolve
// in the node/unit vitest environment while still type-checking call arity.
declare const useConvexQuery: typeof import('../../src/runtime/composables/useConvexQuery').useConvexQuery
declare const useConvexUser: typeof import('../../src/runtime/composables/useConvexUser').useConvexUser
declare const useConvexPaginatedQuery: typeof import('../../src/runtime/composables/useConvexPaginatedQuery').useConvexPaginatedQuery
declare const defineSharedConvexQuery: typeof import('../../src/runtime/composables/defineSharedConvexQuery').defineSharedConvexQuery

type Assert<T extends true> = T
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type QueryOptions = UseConvexQueryOptions<string[]>
type PaginatedOptions = UseConvexPaginatedQueryOptions<{ id: string }>
type QueryArgs = ConvexQueryArgs<{ id: string }>
type PaginatedArgs = ConvexPaginatedQueryArgs<{ id: string }>
type QueryData = UseConvexQueryData<string>

type _QueryUsesInitialData = Assert<
  IsEqual<QueryOptions['initialData'], string[] | (() => string[] | undefined) | undefined>
>
type _PaginatedUsesInitialData = Assert<
  IsEqual<PaginatedOptions['initialData'], { id: string }[] | (() => { id: string }[]) | undefined>
>
type _NuxtPaginationDoesNotExposeAdapterInitialPage = Assert<
  IsEqual<HasKey<PaginatedOptions, 'initialPage'>, false>
>

type _QueryHasNoDefaultOption = Assert<IsEqual<HasKey<QueryOptions, 'default'>, false>>
type _PaginatedHasNoDefaultOption = Assert<IsEqual<HasKey<PaginatedOptions, 'default'>, false>>
type _QueryHasNoEnabledOption = Assert<IsEqual<HasKey<QueryOptions, 'enabled'>, false>>
type _PaginatedHasNoEnabledOption = Assert<IsEqual<HasKey<PaginatedOptions, 'enabled'>, false>>
type _QueryHasNoDeepUnrefArgsOption = Assert<IsEqual<HasKey<QueryOptions, 'deepUnrefArgs'>, false>>
type _PaginatedHasNoDeepUnrefArgsOption = Assert<
  IsEqual<HasKey<PaginatedOptions, 'deepUnrefArgs'>, false>
>
// The auth option accepts exactly the public ConvexAuthMode literals.
type _QueryHasAuthOption = Assert<IsEqual<QueryOptions['auth'], ConvexAuthMode | undefined>>
type _PaginatedHasAuthOption = Assert<IsEqual<PaginatedOptions['auth'], ConvexAuthMode | undefined>>
type _AuthModeLiterals = Assert<IsEqual<ConvexAuthMode, 'required' | 'optional' | 'none'>>
type _QueryArgsUseOnlySkipSentinel = Assert<IsEqual<QueryArgs, { id: string } | 'skip'>>
type _PaginatedArgsUseOnlySkipSentinel = Assert<IsEqual<PaginatedArgs, { id: string } | 'skip'>>
// defineSharedConvexQuery's public `args` field dialect is 'skip' only.
type SharedQueryArgs = DefineSharedConvexQueryOptions<
  FunctionReference<'query', 'public', { id: string }, string>,
  { id: string } | 'skip'
>['args']
type _SharedQueryArgsUseOnlySkipSentinel = Assert<
  IsEqual<SharedQueryArgs, MaybeRefOrGetter<{ id: string } | 'skip'>>
>

type _QueryDataIsReadonlyComputed = Assert<IsEqual<QueryData['data'], ComputedRef<string | null>>>
type _QueryErrorIsComputedErrorNull = Assert<
  IsEqual<QueryData['error'], ComputedRef<ConvexCallError | null>>
>

// ============================================================================
// Negative-space call-arity contracts (decision 9), mirrored against `src`.
// These lines exercise the always-required positional args slot; reverting the
// rest-tuple change breaks the `@ts-expect-error` lines. `_arityContracts` is
// never called.
// ============================================================================

// Convex codegen emits `{}` for argless functions.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type ConvexGeneratedEmptyArgs = {}

declare const noArgQuery: FunctionReference<'query', 'public', ConvexGeneratedEmptyArgs, string[]>
declare const reqArgQuery: FunctionReference<'query', 'public', { id: string }, string>
declare const optArgQuery: FunctionReference<
  'query',
  'public',
  { term?: string; limit?: number },
  string[]
>
// Top-level v.union(...) validators produce union args; each all-optional
// member must be judged by its own keys.
declare const unionOptArgQuery: FunctionReference<
  'query',
  'public',
  { term?: string } | { limit?: number },
  string[]
>
declare const noArgPaginated: FunctionReference<
  'query',
  'public',
  { paginationOpts: PaginationOptions },
  PaginationResult<string>
>
declare const reqArgPaginated: FunctionReference<
  'query',
  'public',
  { owner: string; paginationOpts: PaginationOptions },
  PaginationResult<string>
>

async function _arityContracts() {
  // --- Public type assertions -----------------------------------------------
  void useConvexQuery(noArgQuery, {})
  void useConvexQuery(noArgQuery, 'skip')
  // @ts-expect-error args are always positional
  void useConvexQuery(noArgQuery)
  // @ts-expect-error null is not the skip sentinel
  void useConvexQuery(noArgQuery, null)
  // @ts-expect-error undefined is not the skip sentinel
  void useConvexQuery(noArgQuery, undefined)
  // @ts-expect-error options cannot occupy an exact-empty args slot
  void useConvexQuery(noArgQuery, { server: false })
  // @ts-expect-error shared queries always declare args
  void defineSharedConvexQuery({ query: noArgQuery })
  // @ts-expect-error canonical user queries require positional args
  void useConvexUser(noArgQuery)

  // --- useConvexQuery: required / wrong-shape ----------------------------
  void useConvexQuery(reqArgQuery, { id: 'x' })
  void useConvexQuery(reqArgQuery, 'skip')
  // @ts-expect-error required args must not be omittable
  void useConvexQuery(reqArgQuery)
  // @ts-expect-error wrong arg shape must not compile
  void useConvexQuery(reqArgQuery, { wrong: 1 })
  // @ts-expect-error no-arg functions must reject arbitrary properties
  void useConvexQuery(noArgQuery, { initialNumItems: 5 })

  // --- useConvexQuery: all-optional args still require the slot -----------
  void useConvexQuery(optArgQuery, { limit: 5 })
  void useConvexQuery(optArgQuery, { term: 'x' })
  void useConvexQuery(optArgQuery, {})
  void useConvexQuery(optArgQuery, 'skip')
  // @ts-expect-error all-optional args no longer omit the args slot (decision 9)
  void useConvexQuery(optArgQuery)
  // @ts-expect-error all-optional args still reject unknown properties
  void useConvexQuery(optArgQuery, { limit: 5, wrong: 1 })

  // --- useConvexQuery: union all-optional args ---------------------------
  void useConvexQuery(unionOptArgQuery, { term: 'x' })
  void useConvexQuery(unionOptArgQuery, { limit: 5 })
  void useConvexQuery(unionOptArgQuery, 'skip')
  // @ts-expect-error union all-optional args no longer omit the args slot
  void useConvexQuery(unionOptArgQuery)
  // @ts-expect-error union all-optional args still reject unknown properties
  void useConvexQuery(unionOptArgQuery, { wrong: 1 })

  // --- useConvexPaginatedQuery -------------------------------------------
  void useConvexPaginatedQuery(noArgPaginated, {})
  void useConvexPaginatedQuery(noArgPaginated, 'skip')
  // @ts-expect-error no-arg paginated queries still require the args slot
  void useConvexPaginatedQuery(noArgPaginated)
  // @ts-expect-error null is not the paginated skip sentinel
  void useConvexPaginatedQuery(noArgPaginated, null)
  // @ts-expect-error undefined is not the paginated skip sentinel
  void useConvexPaginatedQuery(noArgPaginated, undefined)
  // @ts-expect-error options object must not be accepted in the args slot
  void useConvexPaginatedQuery(noArgPaginated, { initialNumItems: 5 })
  void useConvexPaginatedQuery(reqArgPaginated, { owner: 'x' })
  // @ts-expect-error required paginated args must not be omittable
  void useConvexPaginatedQuery(reqArgPaginated)
  // @ts-expect-error wrong paginated arg shape must not compile
  void useConvexPaginatedQuery(reqArgPaginated, { wrong: 1 })

  // --- useConvexUser -----------------------------------------------------
  void useConvexUser(reqArgQuery, { id: 'x' })
  // @ts-expect-error required args must not be omittable
  void useConvexUser(reqArgQuery)
  // @ts-expect-error wrong arg shape must not compile
  void useConvexUser(reqArgQuery, { wrong: 1 })

  // --- defineSharedConvexQuery: args field always required ---------------
  defineSharedConvexQuery({ query: noArgQuery, args: {} })
  defineSharedConvexQuery({ query: reqArgQuery, args: { id: 'x' } })
  // @ts-expect-error no-arg shared queries still declare args
  defineSharedConvexQuery({ query: noArgQuery })
  // @ts-expect-error required args field must not be omittable
  defineSharedConvexQuery({ query: reqArgQuery })
  // @ts-expect-error wrong args field shape must not compile
  defineSharedConvexQuery({ query: reqArgQuery, args: { wrong: 1 } })
  defineSharedConvexQuery({ query: reqArgQuery, args: 'skip' })
  // @ts-expect-error null is not the skip sentinel (decision 9)
  defineSharedConvexQuery({ query: reqArgQuery, args: null })
}

describe('query option type contracts', () => {
  it('compiles the supported option and argument shapes', () => {
    expectTypeOf<QueryOptions['auth']>().toEqualTypeOf<ConvexAuthMode | undefined>()
    void _arityContracts
  })
})
