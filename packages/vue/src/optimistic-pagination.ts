// Adapted from convex/react (Apache-2.0).
import type { OptimisticLocalStore } from 'convex/browser'
import { compareValues, convexToJson, type Value } from 'convex/values'

import type {
  PaginatedQueryReference,
  PaginatedQueryArgs,
  PaginatedQueryItem,
} from './use-paginated-query'

/** Insert an item into the first matching page, if it is loaded. */
export function insertAtTop<Query extends PaginatedQueryReference>(options: {
  paginatedQuery: Query
  argsToMatch?: Partial<PaginatedQueryArgs<Query>>
  localQueryStore: OptimisticLocalStore
  item: PaginatedQueryItem<Query>
}): void {
  const { paginatedQuery, argsToMatch, localQueryStore, item } = options
  const firstPage = localQueryStore
    .getAllQueries(paginatedQuery)
    .filter((query) => matchesArgs(query.args, argsToMatch))
    .find((query) => query.args.paginationOpts.cursor === null)
  if (firstPage === undefined || firstPage.value === undefined) return

  localQueryStore.setQuery(paginatedQuery, firstPage.args, {
    ...firstPage.value,
    page: [item, ...firstPage.value.page],
  })
}

/**
 * Update each item on every loaded page of the list whose arguments equal
 * `args` (without `paginationOpts`). Same signature as convex/react.
 */
export function optimisticallyUpdateValueInPaginatedQuery<Query extends PaginatedQueryReference>(
  localStore: OptimisticLocalStore,
  query: Query,
  args: PaginatedQueryArgs<Query>,
  updateValue: (currentValue: PaginatedQueryItem<Query>) => PaginatedQueryItem<Query>,
): void {
  const expectedArgs = JSON.stringify(convexToJson(args as Value))
  for (const queryResult of localStore.getAllQueries(query)) {
    const value = queryResult.value
    if (value === undefined) continue
    const { paginationOpts: _, ...innerArgs } = queryResult.args
    if (JSON.stringify(convexToJson(innerArgs as Value)) !== expectedArgs) continue
    if (typeof value === 'object' && value !== null && Array.isArray(value.page)) {
      localStore.setQuery(query, queryResult.args, { ...value, page: value.page.map(updateValue) })
    }
  }
}

function matchesArgs(
  args: Record<string, unknown>,
  argsToMatch: Record<string, unknown> | undefined,
): boolean {
  return (
    argsToMatch === undefined ||
    Object.entries(argsToMatch).every(
      ([key, value]) =>
        // Query arguments are Convex values; generic types do not retain Value's index signature.
        compareValues(value as Value | undefined, args[key] as Value | undefined) === 0,
    )
  )
}
