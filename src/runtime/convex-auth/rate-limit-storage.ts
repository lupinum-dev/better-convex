import type { BetterAuthOptions } from 'better-auth'
import type { GenericDataModel } from 'convex/server'

import { requireWritableAuthCtx, type AuthCtx } from './context'
import type { AuthAdapterComponentApi } from './types'

const AUTH_RATE_LIMIT_CONTENTION_MAX_RETRIES = 5
const BETTER_AUTH_MAX_BUILT_IN_RATE_LIMIT_WINDOW_SECONDS = 60
type BetterAuthRateLimitStorage = NonNullable<
  NonNullable<BetterAuthOptions['rateLimit']>['customStorage']
>
const ownedStorages = new WeakSet<BetterAuthRateLimitStorage>()

function isFinalConvexContention(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    /documents? read from or written to/iu.test(message) &&
    /changed while this mutation was being run and on every subsequent retry/iu.test(message)
  )
}

function retryDelay(attempt: number): Promise<void> {
  const delayMs = Math.min(5 * 2 ** attempt, 80) + Math.floor(Math.random() * 7)
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export function isConvexAuthRateLimitStorage(
  storage: BetterAuthRateLimitStorage | undefined,
): boolean {
  return storage !== undefined && ownedStorages.has(storage)
}

/**
 * Test seam for constructing a trusted in-memory storage fixture.
 *
 * @internal
 */
export function registerConvexAuthRateLimitStorageForTest(
  storage: BetterAuthRateLimitStorage,
): BetterAuthRateLimitStorage {
  ownedStorages.add(storage)
  return storage
}

/**
 * Create the one atomic Better Auth rate-limit store backed by the auth component.
 * `maximumConfiguredRateLimitWindow` must include every custom plugin rule. The
 * constructor owns the pinned Better Auth built-in 60-second floor. A final
 * Convex OCC error is safe to retry because that mutation did not commit.
 */
export function createConvexAuthRateLimitStorage<DataModel extends GenericDataModel>(
  ctx: AuthCtx<DataModel>,
  component: AuthAdapterComponentApi,
  maximumConfiguredRateLimitWindow: number,
): BetterAuthRateLimitStorage {
  const storage: BetterAuthRateLimitStorage = {
    async consume(key, rule) {
      requireWritableAuthCtx(ctx)
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await ctx.runMutation(component.adapter.consumeRateLimit, {
            key,
            max: rule.max,
            retentionWindow: Math.max(
              BETTER_AUTH_MAX_BUILT_IN_RATE_LIMIT_WINDOW_SECONDS,
              maximumConfiguredRateLimitWindow,
              rule.window,
            ),
            window: rule.window,
          })
        } catch (error) {
          if (
            'db' in ctx ||
            attempt >= AUTH_RATE_LIMIT_CONTENTION_MAX_RETRIES ||
            !isFinalConvexContention(error)
          ) {
            throw error
          }
          await retryDelay(attempt)
        }
      }
    },
  }
  return registerConvexAuthRateLimitStorageForTest(storage)
}
