import type { createAuthClient } from 'better-auth/vue'

import type { ConvexTokenSource } from './token-fetcher'

/** Better Auth client augmented with the prepended Convex token plugin. */
export type AuthClientWithConvex = ReturnType<typeof createAuthClient> & ConvexTokenSource
