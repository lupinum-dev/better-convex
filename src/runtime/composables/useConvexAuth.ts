import { computed, readonly, useNuxtApp, useState } from '#imports'

import type { InferRegisteredConvexAuthClient } from '../auth-client'
import { identityKeyOf, identityUser } from '../auth/auth-identity'
import { ConvexCallError } from '../errors'
import { readConvexRuntimeContext } from '../runtime-context'
import type { UseConvexAuthReturn } from '../utils/auth-contract'
import { useConvexIdentityState } from '../utils/auth-identity-state'
import { deriveConvexAuthStatus, type ConvexAuthStatus } from '../utils/auth-status'
import type { IntegratedAuthClient } from '../utils/integrated-auth-client'

export type { UseConvexAuthReturn } from '../utils/auth-contract'

/**
 * Access Convex authentication state and the inferred integrated Better Auth
 * client. The client is browser-owned, so it is `null` during SSR/early setup.
 * Synchronous Better Auth methods stay synchronous; PromiseLike operations do
 * not settle until their canonical provider session is accepted by Convex.
 */
export function useConvexAuth(): UseConvexAuthReturn<InferRegisteredConvexAuthClient> {
  const nuxtApp = useNuxtApp()
  const identity = useConvexIdentityState()
  const user = computed(() => identityUser(identity.value))
  const authError = useState<string | null>('convex:authError', () => null)
  const pending = useState<boolean>('convex:pending', () => import.meta.client)
  const coordinator = readConvexRuntimeContext(nuxtApp)?.getAuthController() ?? undefined

  const status = computed<ConvexAuthStatus>(() =>
    deriveConvexAuthStatus({
      authEnabled: true,
      settled: !pending.value,
      identityKey: identityKeyOf(identity.value),
      error: authError.value
        ? new ConvexCallError({ kind: 'authentication', message: authError.value })
        : null,
    }),
  )
  const resolvedPending = coordinator ? coordinator.pending : computed(() => pending.value)
  const error = computed<ConvexCallError | undefined>(() =>
    authError.value
      ? new ConvexCallError({ kind: 'authentication', message: authError.value })
      : undefined,
  )

  return {
    status,
    pending: resolvedPending,
    user: readonly(user),
    error,
    client: (coordinator?.client ??
      null) as IntegratedAuthClient<InferRegisteredConvexAuthClient> | null,
    ready: async (options) => {
      if (!coordinator) return status.value
      return coordinator.ready(options)
    },
  }
}
