import type { ComputedRef } from 'vue'
import { computed } from 'vue'

import { useState } from '#imports'

import { identityKeyOf } from '../auth/auth-identity'
import { ConvexCallError } from '../errors'
import { useConvexIdentityState } from './auth-identity-state'
import { useConvexAuthPendingState } from './auth-pending-state'
import { deriveConvexAuthStatus, type ConvexAuthStatus } from './auth-status'
import type { ConvexIdentityKey } from './identity-key'
import { getConvexRuntimeConfig } from './runtime-config'

/**
 * Reactive canonical auth-identity inputs for query gating and isolation
 * tagging (architecture invariant). This is the single place query composables read auth
 * state; they never touch the auth engine directly.
 *
 * Derived from the SSR-seeded reactive state (`convex:pending` / `convex:identity` /
 * `convex:authError`) so it is correct on both server and client, plus the
 * Query isolation generations are owned by the attached Vue runtime; this Nuxt
 * context only derives the server/client execution gate.
 */
export interface ConvexQueryAuthContext {
  readonly status: ComputedRef<ConvexAuthStatus>
  readonly identityKey: ComputedRef<ConvexIdentityKey | null>
  readonly error: ComputedRef<ConvexCallError | null>
}

export function createConvexQueryAuthContext(): ConvexQueryAuthContext {
  const authEnabled = getConvexRuntimeConfig().auth !== false

  const identity = useConvexIdentityState()
  const pending = useConvexAuthPendingState()
  const authError = useState<string | null>('convex:authError', () => null)

  const identityKey = computed<ConvexIdentityKey | null>(() =>
    authEnabled ? identityKeyOf(identity.value) : null,
  )

  const error = computed<ConvexCallError | null>(() => {
    if (!authEnabled) return null
    return authError.value
      ? new ConvexCallError({
          kind: 'authentication',
          message: authError.value,
        })
      : null
  })

  const status = computed<ConvexAuthStatus>(() => {
    if (!authEnabled) return 'disabled'
    if (pending.value) return 'loading'
    return deriveConvexAuthStatus({
      authEnabled: true,
      settled: true,
      identityKey: identityKey.value,
      error: error.value,
    })
  })

  return {
    status,
    identityKey,
    error,
  }
}
