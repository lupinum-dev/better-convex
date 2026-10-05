// Adapted from convex/react (Apache-2.0).
import type { OptimisticLocalStore } from 'convex/browser'
import { compareValues, type Value } from 'convex/values'

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

/** Update each item on every loaded page whose list arguments match. */
export function optimisticallyUpdateValueInPaginatedQuery<
  Query extends PaginatedQueryReference,
>(options: {
  paginatedQuery: Query
  argsToMatch?: Partial<PaginatedQueryArgs<Query>>
  localQueryStore: OptimisticLocalStore
  updateValue: (currentValue: PaginatedQueryItem<Query>) => PaginatedQueryItem<Query>
}): void {
  const { paginatedQuery, argsToMatch, localQueryStore, updateValue } = options
  for (const query of localQueryStore.getAllQueries(paginatedQuery)) {
    const value = query.value
    if (
      value !== undefined &&
      matchesArgs(query.args, argsToMatch) &&
      typeof value === 'object' &&
      value !== null &&
      Array.isArray(value.page)
    ) {
      localQueryStore.setQuery(paginatedQuery, query.args, {
        ...value,
        page: value.page.map(updateValue),
      })
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
