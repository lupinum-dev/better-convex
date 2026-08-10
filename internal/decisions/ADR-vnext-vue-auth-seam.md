# ADR: prove the Vue authentication seam before the package move

- Status: accepted implementation-order correction
- Date: 2026-07-22
- Task: `P4-002`
- Supersedes: the original Phase 4 assumption that the source move could precede auth proof

## Problem

The proven client owner is not independent of authentication. The current Nuxt Better Auth
coordinator drives private owner controls (`initializePrimary`, `failPrimary`, and identity-generation
replacement). Moving the owner into `packages/vue` before defining that seam has only three outcomes,
all rejected by the RFC:

1. Nuxt imports unpublished Vue source;
2. Vue exposes raw owner/client controls through a public internal subpath; or
3. Nuxt retains or copies a second owner.

Therefore the move, public Vue adapter, and Nuxt hard cut are one atomic source cutover. The auth seam
must be proved while the source island is still private.

## Decision

The provider-neutral adapter supplies desired authentication state and a Convex-token callback. It
never receives a raw `ConvexClient` and never controls replacement or disposal.

The proof target is the smallest contract equivalent to:

```ts
interface BrowserAuthSnapshot {
  status: 'loading' | 'authenticated' | 'anonymous' | 'error'
  identityKey: string | null
  sessionGeneration: number
  error: Error | null
}

interface BetterConvexAuthAdapter {
  snapshot(): BrowserAuthSnapshot
  subscribe(listener: () => void): () => void
  fetchToken(input: { forceRefreshToken: boolean }): Promise<string | null>
}
```

The exact names remain private until the proof passes. `identityKey` is only a local isolation key; it
is not authorization. `sessionGeneration` is a monotonic, non-secret credential-lifecycle counter. It
must change when a session is revoked or replaced, including a same-user new session. Providers that
cannot identify a same-user replacement safely may increment more often; over-retirement is safe.

The Vue runtime owns:

- every raw `ConvexClient`;
- `setAuth` and its confirmation callback;
- initial authentication settlement;
- identity-generation allocation and synchronous retirement;
- same-session token refresh without unnecessary identity replacement;
- failure publication, replacement, and disposal.

The provider adapter owns:

- observing its session source;
- deriving a stable non-secret identity isolation key;
- advancing its session generation;
- fetching a short-lived Convex token;
- provider-specific sign-in, sign-out, user, and error semantics outside this generic contract.

## Required proof

Before the source moves, the same private runtime must pass:

- Better Auth-style callback behavior;
- a materially different custom callback provider;
- loading, anonymous, authenticated, error, refresh, revocation, Alice-to-Bob, and same-user new-session
  transitions;
- synchronous protected-state retirement before asynchronous token confirmation;
- no raw client, token value, session identifier, provider user, role, or permission in public identity
  state or diagnostics;
- adapter callback failure and listener failure containment;
- exactly-once unsubscribe and runtime disposal.

After that proof, Phase 4 moves the source once, implements the admitted Vue surface, pins the exact Vue
package in Nuxt, and deletes the Nuxt-owned engine without an intermediate source import.

## Rejected alternatives

- An exported `better-convex-vue/internal` or owner-control API.
- Letting auth adapters call `setAuth`, replace clients, or close clients.
- Passing token refs, raw session IDs, provider user records, roles, or permissions through the seam.
- Treating every token refresh as an identity change when the adapter can prove the same session.
- Moving files first and relying on workspace source imports until a later cleanup.
