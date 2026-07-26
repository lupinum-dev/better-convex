import type { FunctionReference, PaginationOptions, PaginationResult } from 'convex/server'
import { describe, expectTypeOf, it } from 'vitest'
import { ref } from 'vue'

declare const useConvexQuery: typeof import('../../packages/vue/src/use-query').useConvexQuery
declare const useConvexPaginatedQuery: typeof import('../../packages/vue/src/use-paginated-query').useConvexPaginatedQuery

declare const requiredQuery: FunctionReference<'query', 'public', { id: string }, string>
declare const requiredPaginatedQuery: FunctionReference<
  'query',
  'public',
  { owner: string; paginationOpts: PaginationOptions },
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

  void useConvexPaginatedQuery(requiredPaginatedQuery, { owner: 'alice' })
  void useConvexPaginatedQuery(requiredPaginatedQuery, 'skip')
  void useConvexPaginatedQuery(requiredPaginatedQuery, ref<{ owner: string } | 'skip'>('skip'))
  void useConvexPaginatedQuery(requiredPaginatedQuery, () => 'skip' as const)
  // @ts-expect-error required paginated query arguments cannot be omitted
  void useConvexPaginatedQuery(requiredPaginatedQuery)
  // @ts-expect-error null is not a paginated query skip sentinel
  void useConvexPaginatedQuery(requiredPaginatedQuery, null)
  // @ts-expect-error undefined is not a paginated query skip sentinel
  void useConvexPaginatedQuery(requiredPaginatedQuery, undefined)
  // @ts-expect-error a ref containing null is not a paginated query skip sentinel
  void useConvexPaginatedQuery(requiredPaginatedQuery, ref(null))
  // @ts-expect-error a ref containing undefined is not a paginated query skip sentinel
  void useConvexPaginatedQuery(requiredPaginatedQuery, ref(undefined))
  // @ts-expect-error a getter returning null is not a paginated query skip sentinel
  void useConvexPaginatedQuery(requiredPaginatedQuery, () => null)
  // @ts-expect-error a getter returning undefined is not a paginated query skip sentinel
  void useConvexPaginatedQuery(requiredPaginatedQuery, () => undefined)
  // @ts-expect-error ordinary queries are not paginated query references
  void useConvexPaginatedQuery(ordinaryQuery, { owner: 'alice' })
  // @ts-expect-error paginated references must return a pagination result
  void useConvexPaginatedQuery(wrongPaginatedResult, {})
}

describe('better-convex-vue query type contracts', () => {
  it('requires arguments and accepts only paginated references for pagination', () => {
    expectTypeOf(typeContracts).toBeFunction()
  })
})
