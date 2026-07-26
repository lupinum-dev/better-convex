import type { ConvexAuthMode } from './auth-status'
import type { ConvexIdentityKey } from './identity-key'
import { getBetterAuthSessionToken } from './shared-helpers'

// ============================================================================
// Identity-partitioned payload-key grammar (decision 7 / architecture invariant)
// ============================================================================
//
// Convex's `ConvexClient` owns wire deduplication and its per-transport local
// cache, so this module no longer keeps a subscription registry, payload-key
// registry, reference counts, or query bridges. The only library-owned key
// machinery that remains is the payload-key grammar below, which:
//   - partitions Nuxt async-data / payload keys per identity so A's payload can
//     never be read under B (structural cross-user isolation, no token-derived
//     keys, architecture invariant);
//   - lets sign-out/identity purge scan the two namespaces and drop only the
//     `required`/`optional` keys while retaining `none` keys — no registry and
//     no count is consulted.
//
// Grammar (decision 7):
//   required/optional: convex:<fn>:<argsHash>:auth:<mode>:<identityKey>
//   none:              convex:<fn>:<argsHash>:auth:none
//   same shapes under the `convex-paginated:` namespace.

const AUTH_SEGMENT = ':auth:'

/**
 * Append the auth/identity dimension to an identity-blind base key produced by
 * `createConvexQueryKey`. `none` is a static, identity-independent suffix so a
 * public query is shared across sign-in/out; every other mode is partitioned by
 * the concrete `ConvexIdentityKey`.
 */
export function withAuthDimension(
  baseKey: string,
  authMode: ConvexAuthMode,
  identityKey: ConvexIdentityKey,
): string {
  if (authMode === 'none') return `${baseKey}${AUTH_SEGMENT}none`
  return `${baseKey}${AUTH_SEGMENT}${authMode}:${identityKey}`
}

/**
 * A protected SSR payload may seed a browser controller only when the canonical
 * browser identity already names the same principal. The auth adapter seeds an
 * unsettled first generation from SSR provenance, so an anonymous snapshot is a
 * real mismatch here rather than a reason to expose protected data speculatively.
 */
export function matchesConvexHydrationIdentity(
  authMode: ConvexAuthMode,
  payloadIdentity: ConvexIdentityKey,
  browserIdentity:
    | {
        readonly identityKey: ConvexIdentityKey | null
      }
    | undefined,
): boolean {
  return authMode === 'none' || browserIdentity?.identityKey === payloadIdentity
}

/**
 * True when a key belongs to one of the two library-owned Convex payload
 * namespaces.
 */
function isConvexPayloadKey(key: string): boolean {
  return key.startsWith('convex:') || key.startsWith('convex-paginated:')
}

/**
 * Read the `:auth:<mode>` segment of a payload key, or `null` when the key is
 * not a mode-tagged Convex payload key (e.g. an `idle` key or a non-Convex key).
 */
export function readAuthMode(key: string): ConvexAuthMode | null {
  const idx = key.indexOf(AUTH_SEGMENT)
  if (idx < 0) return null
  const rest = key.slice(idx + AUTH_SEGMENT.length)
  const mode = rest.split(':', 1)[0]
  if (mode === 'required' || mode === 'optional' || mode === 'none') return mode
  return null
}

/**
 * Sign-out / identity-change purge (architecture invariant). Scans only the two Convex
 * payload namespaces on the Nuxt payload/state and removes keys whose `:auth:`
 * mode segment is `required` or `optional`; `none` keys are retained and keys
 * outside these namespaces are never touched. No registry or count is consulted.
 *
 * This is the app-global hygiene complement to each composable clearing its own
 * identity-owned state on an identity change; identity-partitioned keys already
 * guarantee a new identity never reads the previous identity's payload.
 */
export function purgeConvexIdentityPayloadKeys(nuxtApp: {
  payload?: { data?: Record<string, unknown>; state?: Record<string, unknown> }
}): string[] {
  const purged: string[] = []
  const scan = (bag: Record<string, unknown> | undefined) => {
    if (!bag) return
    for (const key of Object.keys(bag)) {
      // Nuxt prefixes useState keys with `$s` in payload.state; strip it so the
      // grammar match works against the library key.
      const libKey = key.startsWith('$s') ? key.slice(2) : key
      if (!isConvexPayloadKey(libKey)) continue
      const mode = readAuthMode(libKey)
      if (mode === 'required' || mode === 'optional') {
        Reflect.deleteProperty(bag, key)
        purged.push(key)
      }
    }
  }
  scan(nuxtApp.payload?.data)
  scan(nuxtApp.payload?.state)
  return purged
}

/**
 * Remove identity-bound query errors while retaining anonymous-query errors.
 * Error state is stored under one Nuxt useState key rather than as individual
 * payload keys, so it needs the same auth-mode filtering explicitly.
 */
export function retainAnonymousConvexQueryErrors<T>(
  errors: Readonly<Record<string, T>>,
): Record<string, T> {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => readAuthMode(key) === 'none'))
}

// ============================================================================
// SSR Auth Token Resolution
// ============================================================================

export interface FetchAuthTokenOptions {
  /** Auth transport mode for this query. */
  auth: ConvexAuthMode
  /** Cookie header from the request. */
  cookieHeader: string
  /** Cached token state (must be obtained at setup time via useState). */
  cachedToken: { value: string | null }
}

/**
 * Resolve the SSR auth token for a query.
 *
 * Performs NO cookie -> JWT exchange. `plugin.server.ts` runs before any route
 * component's setup and already exchanged the session cookie once, writing the
 * result into the canonical `useState('convex:identity')`. SSR queries reuse that single
 * per-request exchange. `none` never attaches a token.
 *
 * The `cachedToken` must be obtained at component setup time via
 * the canonical identity state; calling `useState` inside an async function loses
 * Vue context.
 */
export function fetchAuthToken(options: FetchAuthTokenOptions): string | undefined {
  const { auth, cookieHeader, cachedToken } = options
  if (auth === 'none') return undefined
  if (!getBetterAuthSessionToken(cookieHeader)) return undefined
  return cachedToken.value ?? undefined
}
