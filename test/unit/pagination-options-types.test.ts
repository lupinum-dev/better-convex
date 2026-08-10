import type { FunctionReference, PaginationOptions, PaginationResult } from 'convex/server'
import { describe, expectTypeOf, it } from 'vitest'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'

import type { ConvexCallError } from '../../packages/vue/src/errors'
import type {
  PaginatedQueryArgs,
  PaginatedQueryReference,
  UseConvexPaginatedQueryOptions,
  UseConvexPaginatedQueryState,
} from '../../packages/vue/src/use-paginated-query'

declare const usePaginated: typeof import('../../packages/vue/src/use-paginated-query').useConvexPaginatedQuery

interface Row {
  id: string
}

declare const rows: FunctionReference<
  'query',
  'public',
  { workspaceId: string; paginationOpts: PaginationOptions },
  PaginationResult<Row>
>

declare const brandedRows: FunctionReference<
  'query',
  'public',
  {
    workspaceId: string
    readonly source: 'studio'
    paginationOpts: PaginationOptions
  },
  PaginationResult<Row>
>

declare const ordinaryQuery: FunctionReference<'query', 'public', { workspaceId: string }, Row[]>

declare const wrongReturn: FunctionReference<
  'query',
  'public',
  { paginationOpts: PaginationOptions },
  Row[]
>

function reusablePagination<Q extends PaginatedQueryReference>(
  query: Q,
  args: MaybeRefOrGetter<PaginatedQueryArgs<Q> | 'skip'>,
) {
  return usePaginated(query, args, { initialNumItems: 25 })
}

function typeContracts() {
  const direct = usePaginated(rows, { workspaceId: 'workspace' }, { initialNumItems: 25 })
  expectTypeOf(direct.data).toEqualTypeOf<ComputedRef<readonly Row[] | undefined>>()
  expectTypeOf(direct.error).toEqualTypeOf<ComputedRef<ConvexCallError | undefined>>()
  expectTypeOf(direct.status.value).toEqualTypeOf<'idle' | 'pending' | 'success' | 'error'>()

  void reusablePagination(rows, { workspaceId: 'workspace' })
  void reusablePagination(brandedRows, { workspaceId: 'workspace', source: 'studio' })

  // @ts-expect-error pagination options, including initialNumItems, are required
  void usePaginated(rows, { workspaceId: 'workspace' })
  // @ts-expect-error initialNumItems is required
  const missingCount: UseConvexPaginatedQueryOptions = {}
  const readonlyOptions: UseConvexPaginatedQueryOptions = { initialNumItems: 25 }
  // @ts-expect-error public pagination options are immutable inputs
  readonlyOptions.initialNumItems = 50
  void missingCount
  // @ts-expect-error ordinary queries do not accept pagination options/results
  void usePaginated(ordinaryQuery, { workspaceId: 'workspace' }, { initialNumItems: 25 })
  // @ts-expect-error a paginated reference must return PaginationResult
  void usePaginated(wrongReturn, {}, { initialNumItems: 25 })

  type Options = UseConvexPaginatedQueryOptions
  // @ts-expect-error transforms belong in Vue computed values
  const transform: Options = { initialNumItems: 25, transform: (items: Row[]) => items }
  const initialPage: Options = {
    initialNumItems: 25,
    // @ts-expect-error Nuxt hydration seeds are private adapter mechanics
    initialPage: { page: [], isDone: true, continueCursor: '' },
  }
  void transform
  void initialPage
}

describe('pagination type contracts', () => {
  it('supports structural generic wrappers and rejects non-paginated references', () => {
    expectTypeOf(reusablePagination).toBeFunction()
    expectTypeOf<UseConvexPaginatedQueryState<Row>>().toBeObject()
    void typeContracts
  })
})
