import type { FunctionReference, PaginationOptions, PaginationResult } from 'convex/server'
import { describe, expectTypeOf, it } from 'vitest'
import { ref, type ComputedRef } from 'vue'

import type { ConvexCallError } from '../../packages/vue/src/errors'
import type {
  UseConvexPaginatedQueryOptions,
  UseConvexPaginatedQueryState,
} from '../../packages/vue/src/use-paginated-query'
import type { UseConvexQueryOptions, UseConvexQueryState } from '../../packages/vue/src/use-query'

declare const useConvexQuery: typeof import('../../packages/vue/src/use-query').useConvexQuery
declare const useConvexPaginatedQuery: typeof import('../../packages/vue/src/use-paginated-query').useConvexPaginatedQuery

declare const requiredQuery: FunctionReference<'query', 'public', { id: string }, string>
// Convex codegen emits `{}` for an exactly-empty validator.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
declare const emptyQuery: FunctionReference<'query', 'public', {}, string | null>
declare const optionalQuery: FunctionReference<
  'query',
  'public',
  { limit?: number; cursor?: string },
  string[]
>
declare const requiredPaginatedQuery: FunctionReference<
  'query',
  'public',
  { owner: string; paginationOpts: PaginationOptions },
  PaginationResult<string>
>
declare const emptyPaginatedQuery: FunctionReference<
  'query',
  'public',
  { paginationOpts: PaginationOptions },
  PaginationResult<string>
>
declare const ordinaryQuery: FunctionReference<'query', 'public', { owner: string }, string[]>
declare const wrongPaginatedResult: FunctionReference<
  'query',
  'public',
  { paginationOpts: PaginationOptions },
  string[]
>

function typeContracts() {
  void useConvexQuery(emptyQuery)
  void useConvexQuery(emptyQuery, {})
  void useConvexQuery(emptyQuery, 'skip')
  void useConvexQuery(emptyQuery, {}, { auth: 'none', keepPreviousData: true })
  // @ts-expect-error options cannot occupy the exactly-empty args slot
  void useConvexQuery(emptyQuery, { auth: 'none' })

  void useConvexQuery(requiredQuery, { id: 'note' })
  void useConvexQuery(requiredQuery, 'skip')
  void useConvexQuery(requiredQuery, ref<{ id: string } | 'skip'>('skip'))
  void useConvexQuery(requiredQuery, () => 'skip' as const)
  // @ts-expect-error required query arguments cannot be omitted
  void useConvexQuery(requiredQuery)
  // @ts-expect-error null is not a query skip sentinel
  void useConvexQuery(requiredQuery, null)
  // @ts-expect-error undefined is not a query skip sentinel
  void useConvexQuery(requiredQuery, undefined)
  // @ts-expect-error a ref containing null is not a query skip sentinel
  void useConvexQuery(requiredQuery, ref(null))
  // @ts-expect-error a ref containing undefined is not a query skip sentinel
  void useConvexQuery(requiredQuery, ref(undefined))
  // @ts-expect-error a getter returning null is not a query skip sentinel
  void useConvexQuery(requiredQuery, () => null)
  // @ts-expect-error a getter returning undefined is not a query skip sentinel
  void useConvexQuery(requiredQuery, () => undefined)

  void useConvexQuery(optionalQuery, {})
  void useConvexQuery(optionalQuery, { limit: 10 })
  // @ts-expect-error all-optional but nonempty validators still require args
  void useConvexQuery(optionalQuery)

  void useConvexPaginatedQuery(requiredPaginatedQuery, { owner: 'alice' }, { initialNumItems: 10 })
  void useConvexPaginatedQuery(requiredPaginatedQuery, 'skip', { initialNumItems: 10 })
  void useConvexPaginatedQuery(requiredPaginatedQuery, ref<{ owner: string } | 'skip'>('skip'), {
    initialNumItems: 10,
  })
  void useConvexPaginatedQuery(requiredPaginatedQuery, () => 'skip' as const, {
    initialNumItems: 10,
  })
  void useConvexPaginatedQuery(emptyPaginatedQuery, {}, { initialNumItems: 10 })
  // @ts-expect-error an empty-args query still rejects a ref containing null
  void useConvexPaginatedQuery(emptyPaginatedQuery, ref(null), { initialNumItems: 10 })
  // @ts-expect-error an empty-args query still rejects a getter returning undefined
  void useConvexPaginatedQuery(emptyPaginatedQuery, () => undefined, { initialNumItems: 10 })
  // @ts-expect-error pagination options are required
  void useConvexPaginatedQuery(requiredPaginatedQuery, { owner: 'alice' })
  // @ts-expect-error required paginated query arguments cannot be omitted
  void useConvexPaginatedQuery(requiredPaginatedQuery)
  // @ts-expect-error null is not a paginated query skip sentinel
  void useConvexPaginatedQuery(requiredPaginatedQuery, null, { initialNumItems: 10 })
  // @ts-expect-error undefined is not a paginated query skip sentinel
  void useConvexPaginatedQuery(requiredPaginatedQuery, undefined, { initialNumItems: 10 })
  // @ts-expect-error a ref containing null is not a paginated query skip sentinel
  void useConvexPaginatedQuery(requiredPaginatedQuery, ref(null), { initialNumItems: 10 })
  // @ts-expect-error a ref containing undefined is not a paginated query skip sentinel
  void useConvexPaginatedQuery(requiredPaginatedQuery, ref(undefined), { initialNumItems: 10 })
  // @ts-expect-error a getter returning null is not a paginated query skip sentinel
  void useConvexPaginatedQuery(requiredPaginatedQuery, () => null, { initialNumItems: 10 })
  // @ts-expect-error a getter returning undefined is not a paginated query skip sentinel
  void useConvexPaginatedQuery(requiredPaginatedQuery, () => undefined, { initialNumItems: 10 })
  // @ts-expect-error ordinary queries are not paginated query references
  void useConvexPaginatedQuery(ordinaryQuery, { owner: 'alice' }, { initialNumItems: 10 })
  // @ts-expect-error paginated references must return a pagination result
  void useConvexPaginatedQuery(wrongPaginatedResult, {}, { initialNumItems: 10 })
}

describe('better-convex-vue query type contracts', () => {
  it('uses the minimal readonly state and exact argument optionality', () => {
    expectTypeOf<keyof UseConvexQueryOptions>().toEqualTypeOf<'auth' | 'keepPreviousData'>()
    expectTypeOf<UseConvexQueryState<string>['data']>().toEqualTypeOf<
      ComputedRef<string | undefined>
    >()
    expectTypeOf<UseConvexQueryState<string>['error']>().toEqualTypeOf<
      ComputedRef<ConvexCallError | undefined>
    >()
    expectTypeOf<UseConvexQueryState<string>>().not.toHaveProperty('clear')
    expectTypeOf<keyof UseConvexPaginatedQueryOptions>().toEqualTypeOf<
      'auth' | 'initialNumItems' | 'keepPreviousData'
    >()
    expectTypeOf<UseConvexPaginatedQueryState<string>['data']>().toEqualTypeOf<
      ComputedRef<readonly string[] | undefined>
    >()
    expectTypeOf<UseConvexPaginatedQueryState<string>>().not.toHaveProperty('firstPageSettled')
    expectTypeOf<UseConvexPaginatedQueryState<string>>().not.toHaveProperty('results')
    expectTypeOf(typeContracts).toBeFunction()
  })
})
