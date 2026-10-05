import type { BetterAuthRateLimitStorage } from '@better-auth/core'
import type { MemoryDB } from 'better-auth/adapters/memory'
import { convexTest, type TestConvex } from 'convex-test'

import { api } from '../../src/runtime/convex-auth/component/_generated/api'
import schema from '../../src/runtime/convex-auth/component/schema'
import { registerConvexAuthRateLimitStorageForTest } from '../../src/runtime/convex-auth/rate-limit-storage'

const modules = {
  './_generated/api.ts': () => import('../../src/runtime/convex-auth/component/_generated/api'),
  './adapter.ts': () => import('../../src/runtime/convex-auth/component/adapter'),
}
const stores = new WeakMap<MemoryDB, TestConvex<typeof schema>>()

/** Real component quota policy; the MemoryDB key only associates a protocol fixture with its store. */
export function createComponentRateLimitStorage(database: MemoryDB): BetterAuthRateLimitStorage {
  const test = stores.get(database) ?? convexTest(schema, modules)
  stores.set(database, test)
  return registerConvexAuthRateLimitStorageForTest({
    consume: (key, rule) =>
      test.mutation(api.adapter.consumeRateLimit, {
        key,
        max: rule.max,
        window: rule.window,
        retentionWindow: Math.max(60, rule.window),
      }),
  })
}

export async function readComponentRateLimits(database: MemoryDB) {
  const test = stores.get(database)
  if (!test) throw new Error('Create the component rate-limit storage first')
  return test.run((ctx) => ctx.db.query('rateLimit').collect())
}
