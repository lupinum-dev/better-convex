import type { PaginationOptions, PaginationResult } from 'convex/server'

export function isIncompletePaginationPage(
  page: { pageStatus?: 'SplitRecommended' | 'SplitRequired' | null } | null | undefined,
): boolean {
  return page?.pageStatus === 'SplitRequired'
}

/**
 * The SSR first page. A page that Convex marks `SplitRequired` may be
 * incomplete, so it is split once, the way the live list splits it: two
 * bounded calls in parallel, `(cursor, splitCursor]` and
 * `(splitCursor, continueCursor]`. So the server makes at most three calls,
 * and waits for at most two in a row. When a half still needs a split, the
 * result is `undefined`: the server renders the list as not fetched, and the
 * browser splits it live.
 */
export async function fetchSsrFirstPage<Item>(
  options: Pick<PaginationOptions, 'numItems' | 'cursor'>,
  fetchPage: (options: PaginationOptions) => Promise<PaginationResult<Item>>,
): Promise<PaginationResult<Item> | undefined> {
  const page = await fetchPage(options)
  if (!isIncompletePaginationPage(page)) return page
  const splitCursor = page.splitCursor
  if (typeof splitCursor !== 'string' || splitCursor === '') return undefined
  const [head, tail] = await Promise.all([
    fetchPage({ ...options, endCursor: splitCursor }),
    fetchPage({ ...options, cursor: splitCursor, endCursor: page.continueCursor }),
  ])
  if (isIncompletePaginationPage(head) || isIncompletePaginationPage(tail)) return undefined
  // Like Convex's own paginated client: the last part decides where the list continues.
  return {
    page: [...head.page, ...tail.page],
    isDone: tail.isDone,
    continueCursor: tail.continueCursor,
  }
}
