import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createSessionSynchronization,
  type ProviderSessionRevision,
} from '../../src/runtime/auth/session-synchronization'

const session = (
  sessionToken: string | null,
  revision: number,
  failed = false,
): ProviderSessionRevision => ({ sessionToken, revision, failed })

describe('canonical session synchronization', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function fixture({
    timeoutMs = 1_000,
    sessionSignalDelayMs = 10 as number | null,
    refetchCanonicalSession = vi.fn(async () => {}),
  } = {}) {
    const failClosed = vi.fn()
    const synchronization = createSessionSynchronization({
      timeoutMs,
      refetchCanonicalSession,
      failClosed,
      sessionSignalDelayMs,
    })
    return { synchronization, refetchCanonicalSession, failClosed }
  }

  it('settles only after the exact provider token and revision are accepted', async () => {
    const { synchronization, refetchCanonicalSession } = fixture()
    synchronization.observeProvider(session('session-a', 3))
    let settled = false
    const waiting = synchronization
      .reconcile({ revision: 2, sessionSignals: 0, sessionRequests: 0 })
      .then(() => {
        settled = true
      })

    await Promise.resolve()
    synchronization.observeAccepted(session('session-a', 2), false)
    await Promise.resolve()
    expect(settled).toBe(false)
    synchronization.observeAccepted(session('session-b', 3), false)
    await Promise.resolve()
    expect(settled).toBe(false)
    synchronization.observeAccepted(session('session-a', 3), false)

    await waiting
    expect(settled).toBe(true)
    expect(refetchCanonicalSession).toHaveBeenCalledOnce()
  })

  it('treats the signed-out null session as an exact accepted generation', async () => {
    const { synchronization } = fixture()
    synchronization.observeProvider(session(null, 4))
    const waiting = synchronization.reconcile({
      revision: 3,
      sessionSignals: 0,
      sessionRequests: 0,
    })
    await Promise.resolve()
    synchronization.observeAccepted(session(null, 4), false)
    await expect(waiting).resolves.toBeUndefined()
  })

  it('re-reads the newest provider revision when concurrency retires an older one', async () => {
    const { synchronization, refetchCanonicalSession } = fixture()
    synchronization.observeProvider(session('session-bob', 5))
    let settled = false
    const waiting = synchronization
      .reconcile({ revision: 4, sessionSignals: 0, sessionRequests: 0 })
      .then(() => {
        settled = true
      })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(refetchCanonicalSession).toHaveBeenCalledTimes(1)

    synchronization.observeProvider(session('session-carol', 6))
    await vi.waitFor(() => expect(refetchCanonicalSession).toHaveBeenCalledTimes(2))
    synchronization.observeAccepted(session('session-bob', 5), false)
    await Promise.resolve()
    expect(settled).toBe(false)
    synchronization.observeAccepted(session('session-carol', 6), false)

    await waiting
    expect(settled).toBe(true)
  })

  it('lets concurrent opposing operations retire to the one newest generation', async () => {
    const { synchronization } = fixture()
    synchronization.observeProvider(session('session-bob', 7))
    let bobSettled = false
    let carolSettled = false
    const bob = synchronization
      .reconcile({ revision: 6, sessionSignals: 0, sessionRequests: 0 })
      .then(() => {
        bobSettled = true
      })
    const carol = synchronization
      .reconcile({ revision: 6, sessionSignals: 0, sessionRequests: 0 })
      .then(() => {
        carolSettled = true
      })
    await Promise.resolve()

    synchronization.observeProvider(session('session-carol', 8))
    synchronization.observeAccepted(session('session-bob', 7), false)
    await Promise.resolve()
    expect(bobSettled).toBe(false)
    expect(carolSettled).toBe(false)
    synchronization.observeAccepted(session('session-carol', 8), false)

    await Promise.all([bob, carol])
    expect(bobSettled).toBe(true)
    expect(carolSettled).toBe(true)
  })

  it('fails closed on a detected synchronous provider-session change', () => {
    const { synchronization, failClosed } = fixture()
    synchronization.observeProvider(session(null, 0))
    const checkpoint = synchronization.checkpoint()
    synchronization.observeProvider(session('session-sync', 1))

    expect(() => synchronization.cancel(checkpoint)).toThrowError(
      expect.objectContaining({ code: 'SYNCHRONOUS_SESSION_CHANGE' }),
    )
    expect(failClosed).toHaveBeenCalledOnce()
  })

  it('fails closed with a static error when canonical refetch rejects', async () => {
    const { synchronization, failClosed } = fixture({
      refetchCanonicalSession: vi.fn(async () => {
        throw new Error('RAW_REFETCH_SECRET_ae74f9')
      }),
    })
    synchronization.observeProvider(session(null, 0))

    const rejection = await synchronization
      .reconcile({ revision: 0, sessionSignals: 0, sessionRequests: 0 })
      .catch((error) => error)
    expect(rejection).toMatchObject({
      code: 'SESSION_RECONCILIATION_REFRESH_FAILED',
      kind: 'authentication',
    })
    expect(JSON.stringify(rejection)).not.toContain('RAW_REFETCH_SECRET_ae74f9')
    expect(failClosed).toHaveBeenCalledOnce()
  })

  it('fails closed when Convex rejects the exact provider generation', async () => {
    const { synchronization, failClosed } = fixture()
    synchronization.observeProvider(session('session-a', 1))
    const waiting = synchronization.reconcile({
      revision: 0,
      sessionSignals: 0,
      sessionRequests: 0,
    })
    await Promise.resolve()
    synchronization.observeAccepted(session('session-a', 1), true)

    await expect(waiting).rejects.toMatchObject({
      code: 'SESSION_RECONCILIATION_RUNTIME_FAILED',
    })
    expect(failClosed).toHaveBeenCalledOnce()
  })

  it('fails closed once when acceptance exceeds the bounded retry window', async () => {
    vi.useFakeTimers()
    const { synchronization, failClosed } = fixture({ timeoutMs: 50 })
    synchronization.observeProvider(session('session-a', 1))
    const waiting = synchronization.reconcile({
      revision: 0,
      sessionSignals: 0,
      sessionRequests: 0,
    })
    const rejection = expect(waiting).rejects.toMatchObject({
      code: 'SESSION_RECONCILIATION_TIMEOUT',
      kind: 'authentication',
    })

    await vi.advanceTimersByTimeAsync(50)
    await rejection
    expect(failClosed).toHaveBeenCalledOnce()
  })

  it('rejects active reconciliation when disposed and stays idempotent', async () => {
    const { synchronization, failClosed } = fixture()
    synchronization.observeProvider(session('session-a', 1))
    const waiting = synchronization.reconcile({
      revision: 0,
      sessionSignals: 0,
      sessionRequests: 0,
    })
    await Promise.resolve()

    synchronization.dispose()
    synchronization.dispose()

    await expect(waiting).rejects.toMatchObject({ code: 'AUTH_CLIENT_DISPOSED' })
    expect(failClosed).not.toHaveBeenCalled()
  })

  describe('settle', () => {
    it('resolves a call without a session change without refetching or failing closed', async () => {
      const { synchronization, refetchCanonicalSession, failClosed } = fixture()
      synchronization.observeProvider(session('session-a', 1))
      const checkpoint = synchronization.checkpoint()

      await expect(synchronization.settle(checkpoint)).resolves.toBeUndefined()
      expect(refetchCanonicalSession).not.toHaveBeenCalled()
      expect(failClosed).not.toHaveBeenCalled()
    })

    it('reconciles after Better Auth fires its session signal', async () => {
      const { synchronization, refetchCanonicalSession } = fixture()
      synchronization.observeProvider(session('session-a', 1))
      const checkpoint = synchronization.checkpoint()
      synchronization.observeSessionSignal()

      const waiting = synchronization.settle(checkpoint)
      await vi.waitFor(() => expect(refetchCanonicalSession).toHaveBeenCalledOnce())
      synchronization.observeAccepted(session('session-a', 1), false)
      await expect(waiting).resolves.toBeUndefined()
    })

    it('observes a signal Better Auth defers until after the call settled', async () => {
      const { synchronization, refetchCanonicalSession } = fixture()
      synchronization.observeProvider(session(null, 1))
      const checkpoint = synchronization.checkpoint()
      // Better Auth schedules the flip before the action's Promise settles.
      setTimeout(() => synchronization.observeSessionSignal(), 10)

      const waiting = synchronization.settle(checkpoint)
      await vi.waitFor(() => expect(refetchCanonicalSession).toHaveBeenCalledOnce())
      synchronization.observeAccepted(session(null, 1), false)
      await waiting
    })

    it.each([
      '/reset-password',
      '/email-otp/change-email',
      '/sign-in/social',
      '/organization/get-full-organization',
      '/organization/get-organization',
      '/account-info',
      '/passkey/list-user-passkeys',
      '/unknown/plugin',
    ])('reconciles after a %s request even without a session signal', async (routePath) => {
      const { synchronization, refetchCanonicalSession } = fixture()
      synchronization.observeProvider(session('session-a', 1))
      const checkpoint = synchronization.checkpoint()
      synchronization.observeRequest(`${routePath}?callbackURL=%2F`)

      const waiting = synchronization.settle(checkpoint)
      await vi.waitFor(() => expect(refetchCanonicalSession).toHaveBeenCalledOnce())
      synchronization.observeAccepted(session('session-a', 1), false)
      await waiting
    })

    it('does not reconcile after known read-only requests', async () => {
      const { synchronization, refetchCanonicalSession } = fixture()
      synchronization.observeProvider(session('session-a', 1))
      const checkpoint = synchronization.checkpoint()
      synchronization.observeRequest('/get-session?disableCookieCache=true')
      synchronization.observeRequest('/organization/list')

      await expect(synchronization.settle(checkpoint)).resolves.toBeUndefined()
      expect(refetchCanonicalSession).not.toHaveBeenCalled()
    })

    it('reconciles when the provider revision moved without a signal', async () => {
      const { synchronization, refetchCanonicalSession } = fixture()
      synchronization.observeProvider(session('session-a', 1))
      const checkpoint = synchronization.checkpoint()
      synchronization.observeProvider(session('session-b', 2))

      const waiting = synchronization.settle(checkpoint)
      await vi.waitFor(() => expect(refetchCanonicalSession).toHaveBeenCalledOnce())
      synchronization.observeAccepted(session('session-b', 2), false)
      await waiting
    })

    it('still fails closed when a signalled change cannot be reconciled', async () => {
      const { synchronization, failClosed } = fixture({
        sessionSignalDelayMs: 0,
        refetchCanonicalSession: vi.fn(async () => {
          throw new Error('refresh failed')
        }),
      })
      synchronization.observeProvider(session('session-a', 1))
      const checkpoint = synchronization.checkpoint()
      synchronization.observeSessionSignal()

      await expect(synchronization.settle(checkpoint)).rejects.toMatchObject({
        code: 'SESSION_RECONCILIATION_REFRESH_FAILED',
      })
      expect(failClosed).toHaveBeenCalledOnce()
    })

    it('reconciles every call when no session signal is observable', async () => {
      const { synchronization, refetchCanonicalSession } = fixture({ sessionSignalDelayMs: null })
      synchronization.observeProvider(session('session-a', 1))
      const waiting = synchronization.settle(synchronization.checkpoint())
      await vi.waitFor(() => expect(refetchCanonicalSession).toHaveBeenCalledOnce())
      synchronization.observeAccepted(session('session-a', 1), false)
      await waiting
    })

    it('ignores signals after disposal and rejects a pending settle', async () => {
      const { synchronization } = fixture()
      synchronization.observeProvider(session('session-a', 1))
      const waiting = synchronization.settle(synchronization.checkpoint())
      synchronization.dispose()
      synchronization.observeSessionSignal()
      await expect(waiting).rejects.toMatchObject({ code: 'AUTH_CLIENT_DISPOSED' })
    })
  })
})
