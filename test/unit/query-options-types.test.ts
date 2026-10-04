import type { FunctionReference, PaginationOptions, PaginationResult } from 'convex/server'
import { describe, expectTypeOf, it } from 'vitest'
import { ref, toRefs } from 'vue'

import type {
  PaginatedQueryArgs,
  UseNuxtConvexPaginatedQueryOptions,
} from '../../src/runtime/composables/useConvexPaginatedQuery'
import type {
  ConvexQueryArgs,
  UseNuxtConvexQueryOptions,
} from '../../src/runtime/composables/useConvexQuery'
import type { ConvexAuthMode } from '../../src/runtime/utils/auth-status'

// Type-only bindings for the composable functions. `typeof import(...)` is
// erased at compile time, so these never trigger a runtime `#imports` resolve
// in the node/unit vitest environment while still type-checking call arity.
declare const useConvexQuery: typeof import('../../src/runtime/composables/useConvexQuery').useConvexQuery
declare const useConvexPaginatedQuery: typeof import('../../src/runtime/composables/useConvexPaginatedQuery').useConvexPaginatedQuery

function deferredOptionContracts() {
  void useConvexQuery(requiredQuery, { id: 'note' }, { immediate: false })
  void useConvexQuery(requiredQuery, { id: 'note' }, { lazy: true })
  // @ts-expect-error a lazy query starts normally and cannot also be deferred
  void useConvexQuery(requiredQuery, { id: 'note' }, { immediate: false, lazy: true })
}

declare const requiredQuery: FunctionReference<'query', 'public', { id: string }, string>
void deferredOptionContracts

type Assert<T extends true> = T
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

// Option key budgets, state shapes and the native Promise contract are pinned at
// the package root (package-root-query-types) and on the Vue types
// (vue-query-options-types); this file pins the Nuxt argument and arity rules.
type ExamplePaginatedReference = FunctionReference<
  'query',
  'public',
  { id: string; paginationOpts: PaginationOptions },
  PaginationResult<{ id: string }>
>

// The auth option accepts exactly the public ConvexAuthMode literals.
type _PaginatedHasAuthOption = Assert<
  IsEqual<UseNuxtConvexPaginatedQueryOptions['auth'], ConvexAuthMode | undefined>
>
type _AuthModeLiterals = Assert<IsEqual<ConvexAuthMode, 'required' | 'optional' | 'none'>>
type _QueryArgsUseOnlySkipSentinel = Assert<
  IsEqual<ConvexQueryArgs<{ id: string }>, { id: string } | 'skip'>
>
type _PaginatedArgsUseOnlySkipSentinel = Assert<
  IsEqual<PaginatedQueryArgs<ExamplePaginatedReference> | 'skip', { id: string } | 'skip'>
>

// ============================================================================
// Negative-space call-arity contracts mirrored against `src`. Exactly-empty
// queries may omit args; validators with any declared key keep the positional
// args slot. `_arityContracts` is never called.
// ============================================================================

// Convex codegen emits `{}` for argless functions.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type ConvexGeneratedEmptyArgs = {}

declare const noArgQuery: FunctionReference<'query', 'public', ConvexGeneratedEmptyArgs, string[]>
declare const recordEmptyQuery: FunctionReference<'query', 'public', Record<string, never>, string>
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
  void useConvexQuery(noArgQuery)
  void useConvexQuery(noArgQuery, {})
  void useConvexQuery(noArgQuery, 'skip')
  void useConvexQuery(noArgQuery, {}, { server: false })
  void useConvexQuery(recordEmptyQuery)
  void useConvexQuery(recordEmptyQuery, {}, { server: false })
  // @ts-expect-error null is not the skip sentinel
  void useConvexQuery(noArgQuery, null)
  // @ts-expect-error undefined is not the skip sentinel
  void useConvexQuery(noArgQuery, undefined)
  // @ts-expect-error options cannot occupy an exact-empty args slot
  void useConvexQuery(noArgQuery, { server: false })

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
  void useConvexQuery(optArgQuery, { term: 'x' }, { server: false })
  // @ts-expect-error all-optional args still require the args slot
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

  // --- Ref fields in args ------------------------------------------------
  const { id } = toRefs({ id: 'x' } as Readonly<{ id: string }>)
  void useConvexQuery(reqArgQuery, { id })
  void useConvexQuery(optArgQuery, { limit: ref(5) })
  // @ts-expect-error a ref field must hold the argument's type
  void useConvexQuery(reqArgQuery, { id: ref(1) })
  // @ts-expect-error exact-empty args still reject ref fields
  void useConvexQuery(noArgQuery, { id: ref('x') })
  void useConvexPaginatedQuery(reqArgPaginated, { owner: ref('x') }, { initialNumItems: 10 })

  // --- useConvexPaginatedQuery -------------------------------------------
  void useConvexPaginatedQuery(noArgPaginated, {}, { initialNumItems: 10 })
  void useConvexPaginatedQuery(noArgPaginated, 'skip', { initialNumItems: 10 })
  // @ts-expect-error pagination options are required
  void useConvexPaginatedQuery(noArgPaginated, {})
  // @ts-expect-error no-arg paginated queries still require the args slot
  void useConvexPaginatedQuery(noArgPaginated)
  // @ts-expect-error null is not the paginated skip sentinel
  void useConvexPaginatedQuery(noArgPaginated, null, { initialNumItems: 10 })
  // @ts-expect-error undefined is not the paginated skip sentinel
  void useConvexPaginatedQuery(noArgPaginated, undefined, { initialNumItems: 10 })
  void useConvexPaginatedQuery(reqArgPaginated, { owner: 'x' }, { initialNumItems: 10 })
  // @ts-expect-error required paginated args must not be omittable
  void useConvexPaginatedQuery(reqArgPaginated)
  // @ts-expect-error wrong paginated arg shape must not compile
  void useConvexPaginatedQuery(reqArgPaginated, { wrong: 1 }, { initialNumItems: 10 })
}

describe('query option type contracts', () => {
  it('compiles the supported option and argument shapes', () => {
    expectTypeOf<UseNuxtConvexQueryOptions['auth']>().toEqualTypeOf<ConvexAuthMode | undefined>()
    void _arityContracts
  })
})
