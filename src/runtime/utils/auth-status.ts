import { isAuthenticatedIdentityKey } from '@lupinum/better-convex-vue/internal'

import { ConvexCallError } from '../errors'
import type { ConvexIdentityKey } from './identity-key'

/**
 * Per-query authentication mode.
 *
 * | Mode       | Initial auth loading | Settled authenticated | Settled anonymous   |
 * | ---------- | -------------------- | --------------------- | ------------------- |
 * | `required` | Wait                 | Execute with identity | Stay idle           |
 * | `optional` | Wait                 | Execute with identity | Execute anonymously |
 * | `none`     | Do not wait          | Execute anonymously   | Execute anonymously |
 *
 * A query without `auth` uses the build's explicit `convex.auth.defaultQueryAuth`
 * (`optional` unless configured). SSR and the browser read the same value, and
 * there is no `auto` mode.
 */
export type ConvexAuthMode = 'required' | 'optional' | 'none'

/**
 * The identity Convex accepted. `'pending'` until the first result; after that
 * a sign-in, sign-out, or background refresh keeps the previous value until
 * Convex accepts the next one.
 */
export type ConvexAuthStatus = 'pending' | 'anonymous' | 'authenticated' | 'error'

/**
 * The two-dimensional inputs to status derivation. `settled` is the initial
 * auth-settlement signal; `error` is non-null only when initial resolution
 * failed without a usable identity.
 */
export interface ConvexAuthStatusInput {
  settled: boolean
  identityKey: ConvexIdentityKey | null
  error: ConvexCallError | null
}

/**
 * Derive the canonical status in this fixed precedence:
 * `pending` → `authenticated` → `error` → `anonymous`.
 *
 * `authenticated` outranks `error` so a failed background refresh over a still
 * usable identity keeps `authenticated`. `error` outranks `anonymous` so a
 * failed initial resolution surfaces the error instead of silently downgrading
 * to anonymous execution. Nuxt's query identity projection reads the same
 * precedence from here.
 */
export function deriveConvexAuthStatus(input: ConvexAuthStatusInput): ConvexAuthStatus {
  if (!input.settled) return 'pending'
  if (isAuthenticatedIdentityKey(input.identityKey)) return 'authenticated'
  if (input.error) return 'error'
  return 'anonymous'
}

/**
 * The status `useConvexAuth()` shows, from the state Nuxt published after
 * Convex accepted it. `ready()` returns the same value, so the two never differ.
 */
export function publishedConvexAuthStatus(state: {
  pending: boolean
  identityKey: ConvexIdentityKey | null
  authError: string | null
}): ConvexAuthStatus {
  return deriveConvexAuthStatus({
    settled: !state.pending,
    identityKey: state.identityKey,
    error: state.authError
      ? new ConvexCallError({ kind: 'authentication', message: state.authError })
      : null,
  })
}
