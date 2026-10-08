import type { GenericMutationCtx } from 'convex/server'

import { fail } from './actor'
import type { LibraryDataModel } from './functions'
import { everyMs, type Limit } from './policy'

type Db = GenericMutationCtx<LibraryDataModel>['db']

/**
 * Takes one token from the bucket of `key`: a bucket holds `max` tokens and
 * refills `max` per `every`, continuously. Returns `null` when a token was
 * taken, or the whole seconds to wait when the bucket is empty (nothing is
 * written then). The caller runs it in the transaction of the work it limits,
 * so a call that fails gives its token back.
 */
export async function takeToken(
  db: Db,
  key: string,
  limit: Pick<Limit, 'max' | 'every'>,
  now = Date.now(),
): Promise<number | null> {
  const period = everyMs[limit.every]
  const row = await db
    .query('rateLimits')
    .withIndex('by_key', (q) => q.eq('key', key))
    .first()
  const refilled = row
    ? Math.min(limit.max, row.tokens + (Math.max(0, now - row.at) / period) * limit.max)
    : limit.max
  if (refilled < 1) return Math.ceil(((1 - refilled) / limit.max) * (period / 1000))
  const next = { tokens: refilled - 1, at: now }
  if (row) await db.patch(row._id, next)
  else await db.insert('rateLimits', { key, ...next })
  return null
}

/** The failure a caller sees when a limit is reached. */
export function rateLimited(wait: number): never {
  return fail('RATE_LIMITED', `Too many requests. Try again in ${wait} seconds.`)
}
