import type { ComputedRef, Ref } from 'vue'

import type { ConvexCallError } from '../errors'
import type { ConvexAuthStatus } from './auth-status'
import type { IntegratedAuthClient } from './integrated-auth-client'
import type { ConvexUser } from './types'

/**
 * Convex authentication state plus the provider client accepted by the Nuxt
 * runtime. The neutral default keeps the root declaration graph independent
 * from any particular authentication package; `useConvexAuth()` specializes
 * this with the registered Better Auth client inside auth-enabled builds.
 */
export interface UseConvexAuthReturn<Client extends object = object> {
  readonly status: ComputedRef<ConvexAuthStatus>
  readonly pending: ComputedRef<boolean>
  readonly user: Readonly<Ref<ConvexUser | null>>
  readonly error: Readonly<Ref<ConvexCallError | undefined>>
  /** Every PromiseLike client operation crosses canonical session reconciliation. */
  readonly client: IntegratedAuthClient<Client> | null
  ready(options?: { timeoutMs?: number }): Promise<ConvexAuthStatus>
}
