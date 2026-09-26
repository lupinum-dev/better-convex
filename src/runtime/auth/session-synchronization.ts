import { ConvexCallError } from '../errors'
import type { CanonicalSessionReconciler, SessionCheckpoint } from './integrated-client'

export interface ProviderSessionRevision {
  readonly sessionToken: string | null
  readonly revision: number
  readonly failed: boolean
}

export interface SessionSynchronization extends CanonicalSessionReconciler {
  /** Published synchronously by the one Better Auth session observer. */
  observeProvider(session: ProviderSessionRevision): void
  /** Published whenever Better Auth's own `$sessionSignal` fires. */
  observeSessionSignal(): void
  /** Published for every request the Better Auth client starts (route path, no origin). */
  observeRequest(routePath: string): void
  /** Published only after the one Convex runtime has settled this generation. */
  observeAccepted(session: ProviderSessionRevision, failed: boolean): void
  dispose(): void
}

/**
 * Better Auth 1.7 flips `$sessionSignal` for a session-mutating endpoint in a
 * `setTimeout(…, 10)` that it schedules before the action's Promise settles.
 */
export const BETTER_AUTH_SESSION_SIGNAL_DELAY_MS = 10

export interface BetterAuthSessionSignal {
  listen(listener: () => void): () => void
}

/**
 * Better Auth's own session-change signal. Core and every client plugin drive
 * it from their session-mutating endpoints (`atomListeners`) or `$store.notify`.
 */
export function readBetterAuthSessionSignal(client: object): BetterAuthSessionSignal | null {
  const store = Reflect.get(client, '$store') as { atoms?: Record<string, unknown> } | undefined
  const signal = store?.atoms?.$sessionSignal as Partial<BetterAuthSessionSignal> | undefined
  return signal && typeof signal.listen === 'function' ? (signal as BetterAuthSessionSignal) : null
}

/**
 * Better Auth routes known not to change the session or its signed claims.
 * `$sessionSignal` alone is not a complete change signal: several supported
 * endpoints (`/reset-password`, `/email-otp/*`, `/sign-in/social` with an ID
 * token, anything sent with `disableSignal`) rotate, revoke or re-claim the
 * session without flipping it. Every request outside this list is therefore
 * treated as a potential session change; the list only saves reconciliation
 * work for reads and may be incomplete without affecting correctness.
 */
export const READ_ONLY_AUTH_ROUTES: ReadonlySet<string> = new Set([
  '/get-session',
  '/convex/token',
  '/list-sessions',
  '/list-accounts',
  '/account-info',
  '/ok',
  '/organization/list',
  '/organization/get-full-organization',
  '/organization/list-members',
  '/organization/list-invitations',
  '/organization/list-user-invitations',
  '/organization/get-invitation',
  '/organization/get-active-member',
  '/organization/get-active-member-role',
  '/organization/has-permission',
  '/organization/check-slug',
  '/organization/list-teams',
  '/organization/list-team-members',
  '/organization/list-user-teams',
  '/passkey/list-user-passkeys',
])

/** Route path of a Better Auth client request, without query or fragment. */
export function authRoutePath(url: string): string {
  const end = url.search(/[?#]/)
  return end === -1 ? url : url.slice(0, end)
}

const DISPOSED_CODE = 'AUTH_CLIENT_DISPOSED'
const REFRESH_FAILED_CODE = 'SESSION_RECONCILIATION_REFRESH_FAILED'
const RUNTIME_FAILED_CODE = 'SESSION_RECONCILIATION_RUNTIME_FAILED'
const SYNC_CHANGE_CODE = 'SYNCHRONOUS_SESSION_CHANGE'
const TIMEOUT_CODE = 'SESSION_RECONCILIATION_TIMEOUT'

function failure(code: string, message: string): ConvexCallError {
  return new ConvexCallError({ kind: 'authentication', code, message })
}

function sameSession(left: ProviderSessionRevision, right: ProviderSessionRevision): boolean {
  return left.revision === right.revision && left.sessionToken === right.sessionToken
}

/**
 * Correlates the canonical Better Auth session revision with Convex runtime
 * acceptance. Provider tokens remain private to this browser-only boundary.
 */
export function createSessionSynchronization(input: {
  timeoutMs: number
  refetchCanonicalSession: () => Promise<void>
  failClosed: (failure: ConvexCallError) => void
  /**
   * Better Auth flips `$sessionSignal` for a session-mutating endpoint in a
   * timer of this delay, scheduled before the action's Promise settles. Waiting
   * at least as long after settlement orders this check after that flip.
   * `null` means no session signal is observable, so every Promise operation
   * reconciles.
   */
  sessionSignalDelayMs: number | null
}): SessionSynchronization {
  let disposed = false
  let sessionSignals = 0
  let sessionRequests = 0
  let provider: ProviderSessionRevision | undefined
  let accepted: { readonly session: ProviderSessionRevision; readonly failed: boolean } | undefined
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  const failClosed = (authFailure: ConvexCallError): never => {
    try {
      input.failClosed(authFailure)
    } catch {
      // The static library error remains the only caller-visible failure.
    }
    throw authFailure
  }

  const assertActive = () => {
    if (disposed) {
      throw failure(DISPOSED_CODE, 'The integrated authentication client was disposed')
    }
  }

  const waitForNotification = (deadline: number): Promise<void> => {
    assertActive()
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      return Promise.reject(failure(TIMEOUT_CODE, 'Better Auth session reconciliation timed out'))
    }
    return new Promise<void>((resolve, reject) => {
      let active = true
      const finish = (reason?: unknown) => {
        if (!active) return
        active = false
        clearTimeout(timer)
        listeners.delete(wake)
        if (reason) reject(reason)
        else resolve()
      }
      const wake = () => finish()
      const timer = setTimeout(
        () => finish(failure(TIMEOUT_CODE, 'Better Auth session reconciliation timed out')),
        remaining,
      )
      listeners.add(wake)
      if (disposed) {
        finish(failure(DISPOSED_CODE, 'The integrated authentication client was disposed'))
      }
    })
  }

  const withinDeadline = async <Value>(operation: Promise<Value>, deadline: number) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw failure(TIMEOUT_CODE, 'Better Auth session reconciliation timed out')
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(failure(TIMEOUT_CODE, 'Better Auth session reconciliation timed out')),
            remaining,
          )
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  const waitForSessionSignalDelivery = async () => {
    const delay = input.sessionSignalDelayMs
    if (delay === null) return
    await new Promise<void>((resolve) => setTimeout(resolve, delay))
    assertActive()
  }

  const changedSince = (checkpoint: SessionCheckpoint): boolean =>
    input.sessionSignalDelayMs === null ||
    sessionSignals !== checkpoint.sessionSignals ||
    sessionRequests !== checkpoint.sessionRequests ||
    (provider?.revision ?? -1) !== checkpoint.revision

  const waitForProvider = async (deadline: number): Promise<ProviderSessionRevision> => {
    for (;;) {
      assertActive()
      if (provider) return provider
      await waitForNotification(deadline)
    }
  }

  const waitForAcceptanceOrChurn = async (
    expected: ProviderSessionRevision,
    deadline: number,
  ): Promise<'accepted' | 'changed'> => {
    for (;;) {
      assertActive()
      if (provider && !sameSession(provider, expected)) return 'changed'
      if (accepted && sameSession(accepted.session, expected)) {
        if (accepted.failed) {
          throw failure(RUNTIME_FAILED_CODE, 'Convex rejected the refreshed Better Auth session')
        }
        return 'accepted'
      }
      await waitForNotification(deadline)
    }
  }

  const reconcile = async (_checkpoint: SessionCheckpoint): Promise<void> => {
    assertActive()
    const deadline = Date.now() + input.timeoutMs

    try {
      // A concurrent operation may advance the provider while this one waits.
      // Re-read and retry until one exact stable revision is accepted.
      for (;;) {
        await withinDeadline(input.refetchCanonicalSession(), deadline)
        const expected = await waitForProvider(deadline)
        if (expected.failed) {
          throw failure(REFRESH_FAILED_CODE, 'The canonical Better Auth session refresh failed')
        }
        const outcome = await waitForAcceptanceOrChurn(expected, deadline)
        if (outcome === 'accepted') return
      }
    } catch (error) {
      if (error instanceof ConvexCallError) {
        if (error.code === DISPOSED_CODE) throw error
        failClosed(error)
      }
      failClosed(failure(REFRESH_FAILED_CODE, 'The canonical Better Auth session refresh failed'))
    }
  }

  return {
    observeProvider(session) {
      if (disposed) return
      provider = session
      notify()
    },
    observeSessionSignal() {
      if (disposed) return
      sessionSignals += 1
    },
    observeRequest(routePath) {
      if (disposed) return
      if (!READ_ONLY_AUTH_ROUTES.has(authRoutePath(routePath))) sessionRequests += 1
    },
    observeAccepted(session, runtimeFailed) {
      if (disposed) return
      accepted = { session, failed: runtimeFailed }
      notify()
    },
    checkpoint(): SessionCheckpoint {
      assertActive()
      return { revision: provider?.revision ?? -1, sessionSignals, sessionRequests }
    },
    cancel(checkpoint) {
      assertActive()
      if (provider && provider.revision !== checkpoint.revision) {
        failClosed(
          failure(
            SYNC_CHANGE_CODE,
            'A synchronous Better Auth operation changed the provider session',
          ),
        )
      }
    },
    async settle(checkpoint) {
      assertActive()
      await waitForSessionSignalDelivery()
      if (!changedSince(checkpoint)) return
      await reconcile(checkpoint)
    },
    reconcile,
    dispose() {
      if (disposed) return
      disposed = true
      notify()
      listeners.clear()
      provider = undefined
      accepted = undefined
    },
  }
}
