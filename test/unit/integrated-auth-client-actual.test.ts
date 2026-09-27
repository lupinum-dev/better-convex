import { emailOTPClient, organizationClient, twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'

import { convexClientPlugin } from '../../src/runtime/auth-client/convex-client-plugin'
import { createIntegratedAuthClient } from '../../src/runtime/auth/integrated-client'
import {
  BETTER_AUTH_SESSION_SIGNAL_DELAY_MS,
  createSessionSynchronization,
  readBetterAuthSessionSignal,
  type ProviderSessionRevision,
} from '../../src/runtime/auth/session-synchronization'

/**
 * Pins change detection to the real Better Auth 1.7.6 client: every request
 * outside the known read-only routes, plus Better Auth's own `$sessionSignal`,
 * decides which calls reconcile, so read-only calls never refetch the session
 * or mint a token while session changes the signal misses still reconcile.
 */
function createHarness() {
  let serverSessionToken: string | null = 'session:alice'
  let activeOrganizationId: string | null = 'org-1'
  const fetchedPaths: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      const path = url.pathname.replace('/api/auth', '')
      fetchedPaths.push(path)
      const session = serverSessionToken
        ? {
            session: { token: serverSessionToken, activeOrganizationId },
            user: { id: `user:${serverSessionToken}` },
          }
        : null
      switch (path) {
        case '/get-session':
          return Response.json(session ?? { session: null, user: null })
        case '/sign-in/email':
        case '/two-factor/verify-totp':
          serverSessionToken = `session:${fetchedPaths.length}`
          return Response.json({ token: serverSessionToken, user: { id: 'alice' } })
        case '/sign-in/social':
          serverSessionToken = `session:${fetchedPaths.length}`
          return Response.json({ redirect: false, token: serverSessionToken })
        case '/reset-password':
        case '/email-otp/reset-password':
          // `revokeSessionsOnPasswordReset` deletes the caller's sessions.
          serverSessionToken = null
          return Response.json({ status: true })
        case '/email-otp/change-email':
          return Response.json({ status: true })
        case '/sign-out':
          serverSessionToken = null
          return Response.json({ success: true })
        case '/organization/set-active':
          return Response.json({ id: 'org-1' })
        case '/revoke-session':
          return Response.json({ status: true })
        case '/organization/list':
          return Response.json([{ id: 'org-1' }])
        case '/organization/list-members':
          return Response.json({ message: 'boom' }, { status: 500 })
        case '/organization/get-full-organization':
          // Better Auth 1.7.6 clears a non-member's active organization on the
          // session before it answers 403 (plugins/organization/routes/crud-org).
          activeOrganizationId = null
          return Response.json(
            { code: 'USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION' },
            { status: 403 },
          )
        default:
          return Response.json({ message: 'not found' }, { status: 404 })
      }
    }),
  )

  const refetchCanonicalSession = vi.fn(async () => {
    await canonicalSession.value.refetch()
    if (canonicalSession.value.error) throw new Error('canonical refresh failed')
  })
  const failClosed = vi.fn()
  const synchronization = createSessionSynchronization({
    timeoutMs: 1_000,
    refetchCanonicalSession,
    failClosed,
    sessionSignalDelayMs: BETTER_AUTH_SESSION_SIGNAL_DELAY_MS,
  })
  const raw = createAuthClient({
    baseURL: 'https://auth.example.test/api/auth',
    plugins: [
      convexClientPlugin({
        observeRequest: (routePath) => synchronization.observeRequest(routePath),
      }),
      organizationClient(),
      twoFactorClient(),
      emailOTPClient(),
    ],
  })
  const canonicalSession = raw.useSession()
  const signal = readBetterAuthSessionSignal(raw)
  expect(signal).not.toBeNull()
  const stopSignal = signal!.listen(() => synchronization.observeSessionSignal())

  let revision = 0
  let lastToken: string | null | undefined
  const stopWatch = watch(
    [
      () => canonicalSession.value.data?.session?.token ?? null,
      () => canonicalSession.value.error,
    ] as const,
    ([sessionToken, error]) => {
      if (sessionToken !== lastToken) revision += 1
      lastToken = sessionToken
      const provider: ProviderSessionRevision = {
        sessionToken,
        revision,
        failed: error !== null,
      }
      synchronization.observeProvider(provider)
      // Stand-in for the Convex runtime accepting this exact generation.
      synchronization.observeAccepted(provider, false)
    },
    { flush: 'sync', immediate: true },
  )
  const integrated = createIntegratedAuthClient(raw, synchronization)
  const sessionFetches = () => fetchedPaths.filter((path) => path === '/get-session').length

  return {
    integrated,
    refetchCanonicalSession,
    failClosed,
    sessionFetches,
    dispose() {
      stopWatch()
      stopSignal()
      synchronization.dispose()
    },
  }
}

describe('integrated client against pinned Better Auth 1.7.6', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves read-only calls without reconciling or refetching the session', async () => {
    const harness = createHarness()
    const before = harness.sessionFetches()

    await expect(harness.integrated.organization.list()).resolves.toMatchObject({
      data: [{ id: 'org-1' }],
    })
    await harness.integrated.getSession()

    expect(harness.refetchCanonicalSession).not.toHaveBeenCalled()
    // Only the explicit getSession() read reached /get-session.
    expect(harness.sessionFetches()).toBe(before + 1)
    harness.dispose()
  })

  it('does not fail closed when a read-only call fails', async () => {
    const harness = createHarness()

    const result = await harness.integrated.organization.listMembers()
    expect(result.error).toMatchObject({ status: 500 })
    await expect(
      harness.integrated.organization.listMembers({ fetchOptions: { throw: true } }),
    ).rejects.toBeDefined()

    expect(harness.refetchCanonicalSession).not.toHaveBeenCalled()
    expect(harness.failClosed).not.toHaveBeenCalled()
    harness.dispose()
  })

  it('reconciles a get-full-organization membership failure that cleared the active organization', async () => {
    const harness = createHarness()

    const result = await harness.integrated.organization.getFullOrganization({
      query: { organizationId: 'org-foreign' },
    })
    expect(result.error).toMatchObject({ status: 403 })

    expect(harness.refetchCanonicalSession).toHaveBeenCalledTimes(1)
    expect(harness.failClosed).not.toHaveBeenCalled()
    harness.dispose()
  })

  it.each([
    [
      'sign-in',
      (client: ReturnType<typeof createHarness>['integrated']) =>
        client.signIn.email({ email: 'alice@example.test', password: 'correct horse' }),
    ],
    ['sign-out', (client: ReturnType<typeof createHarness>['integrated']) => client.signOut()],
    [
      'two-factor verify',
      (client: ReturnType<typeof createHarness>['integrated']) =>
        client.twoFactor.verifyTotp({ code: '123456' }),
    ],
    [
      'organization set-active',
      (client: ReturnType<typeof createHarness>['integrated']) =>
        client.organization.setActive({ organizationId: 'org-1' }),
    ],
    [
      'revoke session',
      (client: ReturnType<typeof createHarness>['integrated']) =>
        client.revokeSession({ token: 'session:other' }),
    ],
    [
      'password reset (revokes sessions, no session signal)',
      (client: ReturnType<typeof createHarness>['integrated']) =>
        client.resetPassword({ newPassword: 'new correct horse', token: 'reset-token' }),
    ],
    [
      'email OTP password reset (no session signal)',
      (client: ReturnType<typeof createHarness>['integrated']) =>
        client.emailOtp.resetPassword({
          email: 'alice@example.test',
          otp: '123456',
          password: 'new correct horse',
        }),
    ],
    [
      'email OTP change-email (email claim, no session signal)',
      (client: ReturnType<typeof createHarness>['integrated']) =>
        client.emailOtp.changeEmail({ newEmail: 'alice@new.example.test', otp: '123456' }),
    ],
    [
      'social sign-in with an ID token (no redirect, no session signal)',
      (client: ReturnType<typeof createHarness>['integrated']) =>
        client.signIn.social({ provider: 'google', idToken: { token: 'id-token' } }),
    ],
    [
      'a session-changing call sent with disableSignal',
      (client: ReturnType<typeof createHarness>['integrated']) =>
        client.signOut({ fetchOptions: { disableSignal: true } }),
    ],
  ])('reconciles %s through the canonical session', async (_name, operation) => {
    const harness = createHarness()

    await operation(harness.integrated)

    expect(harness.refetchCanonicalSession).toHaveBeenCalledOnce()
    expect(harness.failClosed).not.toHaveBeenCalled()
    harness.dispose()
  })
})
