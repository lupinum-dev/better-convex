import type { BrowserAuthAdapter, BrowserAuthSnapshot } from '../internal/auth-adapter'
import { testTokenFor } from './transport'

/** The identity a test starts with or moves to. */
export type BetterConvexTestAuthState = 'authenticated' | 'anonymous' | 'loading' | 'error'

/**
 * The signed-in identity behind the test runtime. Each change runs through the
 * real auth port and client owner: a different subject or a renewed session
 * starts a new identity generation, retires the previous Convex client, and
 * fences every request the previous identity started.
 */
export interface BetterConvexTestAuthControl {
  readonly status: BetterConvexTestAuthState
  /** The signed-in subject, or `null`. */
  readonly subject: string | null
  /** Sign in as `subject` (default `test-user`); no change when already signed in as it. */
  signIn(subject?: string): void
  signOut(): void
  /** Keep the subject but replace its session, as a re-login does. */
  renewSession(): void
  /** Return to the unresolved state before the provider answers. */
  setLoading(): void
  /** Fail authentication; queries that require a user stop and writes are fenced. */
  fail(error?: Error): void
  /** Observe changes; presentation layers such as the Nuxt `useConvexAuth` double use it. */
  subscribe(listener: () => void): () => void
}

export type BetterConvexTestAuthInput =
  | Exclude<BetterConvexTestAuthState, 'authenticated'>
  | { readonly subject: string }

export const DEFAULT_TEST_SUBJECT = 'test-user'

export function createTestAuth(initial: BetterConvexTestAuthInput) {
  let sessionGeneration = 0
  const toSnapshot = (
    status: BetterConvexTestAuthState,
    subject: string | null,
    error: Error | null = null,
  ): BrowserAuthSnapshot =>
    Object.freeze({
      status,
      identityKey: status === 'authenticated' ? subject : null,
      sessionGeneration,
      error: status === 'error' ? (error ?? new Error('Test authentication failed')) : null,
    })

  let snapshot =
    typeof initial === 'object'
      ? toSnapshot('authenticated', initial.subject)
      : toSnapshot(initial, null)
  const listeners = new Set<() => void>()

  const change = (status: BetterConvexTestAuthState, subject: string | null, error?: Error) => {
    sessionGeneration += 1
    snapshot = toSnapshot(status, subject, error)
    for (const listener of [...listeners]) listener()
  }

  const adapter: BrowserAuthAdapter = {
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    fetchToken: async () =>
      snapshot.status === 'authenticated' && snapshot.identityKey
        ? testTokenFor(snapshot.identityKey)
        : null,
    refreshSession: async () => {},
  }

  const control: BetterConvexTestAuthControl = {
    get status() {
      return snapshot.status
    },
    get subject() {
      return snapshot.identityKey
    },
    signIn(subject = DEFAULT_TEST_SUBJECT) {
      if (snapshot.status === 'authenticated' && snapshot.identityKey === subject) return
      change('authenticated', subject)
    },
    signOut() {
      if (snapshot.status === 'anonymous') return
      change('anonymous', null)
    },
    renewSession() {
      if (snapshot.status !== 'authenticated') {
        throw new Error('[better-convex-test] renewSession() needs a signed-in subject')
      }
      change('authenticated', snapshot.identityKey)
    },
    setLoading() {
      change('loading', null)
    },
    fail(error) {
      change('error', null, error)
    },
    subscribe: adapter.subscribe,
  }

  return { adapter, control: Object.freeze(control) }
}
