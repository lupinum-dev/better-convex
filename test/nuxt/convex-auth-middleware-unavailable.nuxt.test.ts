import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRuntimeConfig, useState } from '#imports'

const { navigateToMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn((target: unknown) => ({ navigatedTo: target })),
}))

vi.mock('#app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#app')>()),
  navigateTo: navigateToMock,
}))

vi.mock('../../src/runtime/composables/useConvexActivation', () => ({
  useConvexActivation: () => ({ activate: async () => {} }),
}))

type Middleware = (to: object) => Promise<unknown>

const UNAVAILABLE = {
  code: 'AUTH_UNAVAILABLE',
  message: 'Authentication is temporarily unavailable',
}

// The real useConvexAuth reads the published auth state, as after hydration:
// `convex:authError` comes from the server render or the browser runtime, and
// `convex:pending` stays true while the browser still waits out a failure.
describe('convex-auth route middleware in the browser while auth is temporarily unavailable', () => {
  beforeEach(() => {
    navigateToMock.mockClear()
    ;(useRuntimeConfig().public as Record<string, unknown>).convex = {
      auth: { origin: 'http://localhost:3000' },
    }
  })

  it.each([
    {
      case: 'hydrating after a server render that hit a temporary failure, browser still waiting',
      pending: true,
      authError: UNAVAILABLE,
      redirects: false,
    },
    {
      case: 'browser retries ran out, auth reported temporarily unavailable',
      pending: false,
      authError: UNAVAILABLE,
      redirects: false,
    },
    { case: 'definitively signed out', pending: false, authError: null, redirects: true },
    {
      case: 'Convex rejected the token',
      pending: false,
      authError: { code: null, message: 'Convex rejected the authentication token' },
      redirects: true,
    },
    {
      case: 'the auth backend answered in a way only a wrong setup explains',
      pending: false,
      authError: { code: 'AUTH_MISCONFIGURED', message: 'Authentication is not set up correctly' },
      redirects: true,
    },
    {
      case: 'the unavailable message without its code',
      pending: false,
      authError: { code: null, message: UNAVAILABLE.message },
      redirects: true,
    },
  ])('$case: redirects to sign-in = $redirects', async ({ pending, authError, redirects }) => {
    useState<boolean>('convex:pending').value = pending
    useState<typeof authError>('convex:authError').value = authError
    const middleware = (await import('../../src/runtime/middleware/convex-auth.global'))
      .default as unknown as Middleware

    await middleware({
      path: '/dashboard',
      fullPath: '/dashboard',
      query: {},
      meta: { convexAuth: true },
    })

    if (redirects) expect(navigateToMock).toHaveBeenCalledWith('/auth/signin?redirect=%2Fdashboard')
    else expect(navigateToMock).not.toHaveBeenCalled()
  })
})
