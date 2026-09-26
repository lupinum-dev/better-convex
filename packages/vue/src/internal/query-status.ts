import type { ConvexCallStatus } from '../use-callable'

export interface QueryStatusInput {
  readonly pending: boolean
  readonly error: boolean
  readonly hasData: boolean
}

/**
 * The one query status projection. The browser lifecycle and the Nuxt SSR
 * render both derive status here, so a hydrating browser shows exactly the
 * status the server rendered from the same payload.
 */
export function deriveQueryStatus(input: QueryStatusInput): ConvexCallStatus {
  if (input.pending) return 'pending'
  if (input.error) return 'error'
  return input.hasData ? 'success' : 'idle'
}
