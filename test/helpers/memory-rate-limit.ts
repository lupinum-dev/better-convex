import type { BetterAuthRateLimitStorage } from '@better-auth/core'
import type { MemoryDB } from 'better-auth/adapters/memory'

import { registerConvexAuthRateLimitStorageForTest } from '../../src/runtime/convex-auth/rate-limit-storage'

export function createMemoryRateLimitStorage(database: MemoryDB): BetterAuthRateLimitStorage {
  return registerConvexAuthRateLimitStorageForTest({
    async consume(key, rule) {
      const now = Date.now()
      const windowInMs = rule.window * 1_000
      database.rateLimit ??= []
      const current = database.rateLimit.find((row) => row.key === key)
      if (!current) {
        database.rateLimit.push({ id: key, key, count: 1, lastRequest: now })
        return { allowed: true, retryAfter: null }
      }
      if (now - Number(current.lastRequest) >= windowInMs) {
        current.count = 1
        current.lastRequest = now
        return { allowed: true, retryAfter: null }
      }
      if (Number(current.count) >= rule.max) {
        return {
          allowed: false,
          retryAfter: Math.max(
            1,
            Math.ceil((Number(current.lastRequest) + windowInMs - now) / 1_000),
          ),
        }
      }
      current.count = Number(current.count) + 1
      current.lastRequest = now
      return { allowed: true, retryAfter: null }
    },
  })
}
