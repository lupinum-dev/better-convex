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
  /** Published only after the one Convex runtime has settled this generation. */
  observeAccepted(session: ProviderSessionRevision, failed: boolean): void
  dispose(): void
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
}): SessionSynchronization {
  let disposed = false
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

  return {
    observeProvider(session) {
      if (disposed) return
      provider = session
      notify()
    },
    observeAccepted(session, runtimeFailed) {
      if (disposed) return
      accepted = { session, failed: runtimeFailed }
      notify()
    },
    checkpoint(): SessionCheckpoint {
      assertActive()
      return { revision: provider?.revision ?? -1 }
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
    async reconcile(_checkpoint) {
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
    },
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
