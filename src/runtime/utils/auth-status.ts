import { isAuthenticatedIdentityKey } from '@lupinum/better-convex-vue/internal'

import type { ConvexCallError } from '../errors'
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
 * The fixed default is `optional`. There is no `auto` mode and no per-build
 * default override; auth policy must not change invisibly between applications.
 */
export type ConvexAuthMode = 'required' | 'optional' | 'none'

/**
 * Current usable identity. Orthogonal to `pending`, which tracks auth work in
 * flight. A background refresh keeps `status === 'authenticated'` while
 * `pending === true`.
 */
export type ConvexAuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'error'

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
 * `loading` → `authenticated` → `error` → `anonymous`.
 *
 * `authenticated` outranks `error` so a failed background refresh over a still
 * usable identity keeps `authenticated`. `error` outranks `anonymous` so a
 * failed initial resolution surfaces the error instead of silently downgrading
 * to anonymous execution. Nuxt's query identity projection reads the same
 * precedence from here.
 */
export function deriveConvexAuthStatus(input: ConvexAuthStatusInput): ConvexAuthStatus {
  if (!input.settled) return 'loading'
  if (isAuthenticatedIdentityKey(input.identityKey)) return 'authenticated'
  if (input.error) return 'error'
  return 'anonymous'
}
