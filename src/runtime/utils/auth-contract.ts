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
  /** `true` while `status` is `'pending'`, as in every other composable. */
  readonly pending: ComputedRef<boolean>
  /** The signed-in user. Server rendering hydrates it, so read identity here. */
  readonly user: Readonly<Ref<ConvexUser | null>>
  readonly error: ComputedRef<ConvexCallError | undefined>
  /**
   * The Better Auth client. A PromiseLike operation that changes the session
   * (Better Auth's session signal or a new provider session revision) settles
   * only after Convex accepts the resulting session; read-only operations
   * settle without touching it.
   *
   * It is always present, so destructuring and property reads are safe during
   * server rendering and setup. The real client exists only in the browser
   * after the Convex runtime starts; before that (and on the server) calling
   * any member throws a `ConvexCallError` with code `CLIENT_UNAVAILABLE`.
   */
  readonly client: IntegratedAuthClient<Client>
  ready(options?: { timeoutMs?: number }): Promise<ConvexAuthStatus>
}
