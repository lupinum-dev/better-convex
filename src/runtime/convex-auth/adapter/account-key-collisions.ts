import type { GenericActionCtx, GenericDataModel } from 'convex/server'
import { compareValues } from 'convex/values'

import type { AuthAdapterComponentApi } from '../types'

/** Account rows that share one `(providerId, accountId)` key. */
export interface AccountKeyCollision {
  readonly providerId: string
  readonly accountId: string
  /** Every row with this key: its logical account id and owning user id. */
  readonly accounts: ReadonlyArray<{ readonly id: string; readonly userId: string }>
}

export interface AccountKeyCollisionReport {
  /** Account rows this call read. */
  readonly scannedAccounts: number
  /** Collisions that this call completed; each is reported by exactly one call. */
  readonly collisions: readonly AccountKeyCollision[]
  /** `true` when the whole table was read. */
  readonly isDone: boolean
  /**
   * Pass it as `cursor` to the next call while `isDone` is `false`; `null`
   * once the walk is done. Opaque: it carries the last key's rows so that a
   * collision across two calls is still found.
   */
  readonly continueCursor: string | null
}

export interface FindAccountKeyCollisionsOptions {
  /** Physical account model name. Defaults to `account`. */
  readonly model?: string
  /** Rows per component query, 1-100. Defaults to 100. */
  readonly pageSize?: number
  /** Component queries per call, 1-1000. Defaults to 100. */
  readonly maxPages?: number
  /** The previous call's `continueCursor`. Omit it, or pass `null`, to start. */
  readonly cursor?: string | null
}

interface AccountKeyRow {
  readonly id: string
  readonly providerId: string
  readonly accountId: string
  readonly userId: string
}

const MAX_PAGE_SIZE = 100
const DEFAULT_MAX_PAGES = 100
const MAX_PAGES = 1000

function accountKeyRow(row: Record<string, unknown>): AccountKeyRow {
  const { id, providerId, accountId, userId } = row
  if (
    typeof id !== 'string' ||
    typeof providerId !== 'string' ||
    typeof accountId !== 'string' ||
    typeof userId !== 'string'
  ) {
    throw new TypeError('AUTH_ACCOUNT_SCAN_ROW_INVALID')
  }
  return { id, providerId, accountId, userId }
}

/** The resume state between calls: the component cursor and the open key's rows. */
function encodeCursor(cursor: string, run: readonly AccountKeyRow[]): string {
  return JSON.stringify({ cursor, run })
}

function decodeCursor(value: string): { cursor: string; run: AccountKeyRow[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new TypeError('AUTH_ACCOUNT_SCAN_CURSOR_INVALID')
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { cursor?: unknown }).cursor !== 'string' ||
    !Array.isArray((parsed as { run?: unknown }).run)
  ) {
    throw new TypeError('AUTH_ACCOUNT_SCAN_CURSOR_INVALID')
  }
  const { cursor, run } = parsed as { cursor: string; run: unknown[] }
  const rows = run.map((row) => {
    try {
      return accountKeyRow(row as Record<string, unknown>)
    } catch {
      throw new TypeError('AUTH_ACCOUNT_SCAN_CURSOR_INVALID')
    }
  })
  const [first] = rows
  if (
    first &&
    rows.some((row) => row.providerId !== first.providerId || row.accountId !== first.accountId)
  ) {
    throw new TypeError('AUTH_ACCOUNT_SCAN_CURSOR_INVALID')
  }
  return { cursor, run: rows }
}

/**
 * Find account rows that Better Auth 1.7.3+ cannot tell apart.
 *
 * Better Convex 1.0.0-beta releases ran Better Auth 1.7.1/1.7.2, which keyed
 * accounts by `(issuer, accountId)`; 1.0 keys them by `(providerId, accountId)`.
 * Two beta rows collide only when one provider id stored the same subject
 * under two issuers. Better Auth refuses to sign in a colliding identity, so
 * merge or delete the extra rows before or right after the upgrade.
 *
 * Call it from an internal action. It walks the `(providerId, accountId)`
 * index, so colliding rows arrive next to each other. One call reads at most
 * `maxPages` pages of at most `pageSize` rows (10,000 rows by default). While
 * `isDone` is `false`, call it again with `cursor: continueCursor`; the
 * collisions of every call together are the full report.
 */
export async function findAccountKeyCollisions(
  ctx: Pick<GenericActionCtx<GenericDataModel>, 'runQuery'>,
  component: AuthAdapterComponentApi,
  options: FindAccountKeyCollisionsOptions = {},
): Promise<AccountKeyCollisionReport> {
  const model = options.model ?? 'account'
  const pageSize = options.pageSize ?? MAX_PAGE_SIZE
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new RangeError('AUTH_ACCOUNT_SCAN_PAGE_SIZE_INVALID')
  }
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES) {
    throw new RangeError('AUTH_ACCOUNT_SCAN_MAX_PAGES_INVALID')
  }
  const resume = options.cursor == null ? null : decodeCursor(options.cursor)

  const collisions: AccountKeyCollision[] = []
  let scannedAccounts = 0
  let run: AccountKeyRow[] = resume?.run ?? []
  const closeRun = () => {
    if (run.length > 1) {
      collisions.push({
        providerId: run[0]!.providerId,
        accountId: run[0]!.accountId,
        accounts: run.map(({ id, userId }) => ({ id, userId })),
      })
    }
  }

  let cursor: string | null = resume?.cursor ?? null
  for (let pages = 1; ; pages += 1) {
    const page: { page: Record<string, unknown>[]; isDone: boolean; continueCursor: string } =
      await ctx.runQuery(component.adapter.findMany, {
        model,
        // A range on the leading field selects the (providerId, accountId)
        // index for the whole table, in index order.
        where: [{ field: 'providerId', operator: 'gte', value: '' }],
        select: ['id', 'providerId', 'accountId', 'userId'],
        paginationOpts: { cursor, numItems: pageSize },
      })
    for (const raw of page.page) {
      const row = accountKeyRow(raw)
      scannedAccounts += 1
      const previous = run[0]
      const order = previous
        ? compareValues([previous.providerId, previous.accountId], [row.providerId, row.accountId])
        : -1
      // Adjacency is the whole proof; refuse to report on any other order.
      if (order > 0) throw new Error('AUTH_ACCOUNT_SCAN_ORDER_INVALID')
      if (order < 0) {
        closeRun()
        run = []
      }
      run.push(row)
    }
    if (page.isDone) break
    if (page.continueCursor === cursor) throw new Error('AUTH_ACCOUNT_SCAN_STALLED')
    cursor = page.continueCursor
    // The open key may continue on the next page: carry its rows instead of
    // reporting a partial group.
    if (pages === maxPages) {
      return {
        scannedAccounts,
        collisions,
        isDone: false,
        continueCursor: encodeCursor(cursor, run),
      }
    }
  }
  closeRun()
  return { scannedAccounts, collisions, isDone: true, continueCursor: null }
}
