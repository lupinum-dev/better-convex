import { describe, expect, it } from 'vitest'

import {
  normalizeLocalRedirectPath,
  resolveGuestRedirect,
  resolveRoutePolicy,
  resolveRouteProtectionDecision,
} from '../../src/runtime/utils/auth-route-protection'

const OPEN_REDIRECT_VECTORS = [
  '//evil.example/steal',
  '/\\evil.example/steal',
  '/%5Cevil.example/steal',
  '/%5cevil.example/steal',
  '/%2F%2Fevil.example/steal',
  '/%2f%2fevil.example',
  '%2F%2Fevil.example',
  '/\t/evil.example',
  '/%09/evil.example',
  '///evil.example',
  '/.//evil.example',
  '/..//evil.example',
  'https://evil.example/steal',
  'HTTPS://evil.example',
  'javascript:alert(1)',
  'evil.example/steal',
  ' /dashboard',
  '/safe\nforged',
  '/safe%0d%0aforged',
  '/broken%zz',
  '',
] as const

describe('route protection decision', () => {
  it('does nothing when page is not protected', () => {
    expect(
      resolveRouteProtectionDecision({
        meta: undefined,
        defaultRedirectTo: '/auth/signin',
        currentPath: '/dashboard',
      }),
    ).toBeNull()
  })

  it('redirects to default route and preserves return path', () => {
    const decision = resolveRouteProtectionDecision({
      meta: true,
      defaultRedirectTo: '/auth/signin',
      currentPath: '/dashboard',
      currentFullPath: '/dashboard?tab=team',
    })
    expect(decision).toEqual({
      redirectTo: '/auth/signin?redirect=%2Fdashboard%3Ftab%3Dteam',
    })
  })

  it('uses per-page redirect override and avoids loops', () => {
    expect(
      resolveRouteProtectionDecision({
        meta: { redirectTo: '/login' },
        defaultRedirectTo: '/auth/signin',
        currentPath: '/dashboard',
      }),
    ).toEqual({ redirectTo: '/login?redirect=%2Fdashboard' })

    expect(
      resolveRouteProtectionDecision({
        meta: { redirectTo: '/login' },
        defaultRedirectTo: '/auth/signin',
        currentPath: '/login',
      }),
    ).toBeNull()
  })

  it('supports object redirects without mutating route objects', () => {
    const routeTarget = { path: '/login', query: { source: 'guard' } }

    expect(
      resolveRouteProtectionDecision({
        meta: { redirectTo: routeTarget },
        defaultRedirectTo: '/auth/signin',
        currentPath: '/dashboard',
        currentFullPath: '/dashboard?tab=team',
      }),
    ).toEqual({ redirectTo: routeTarget })
  })

  it.each(OPEN_REDIRECT_VECTORS)(
    'falls back to the default sign-in route for an unsafe per-page target: %s',
    (redirectTo) => {
      expect(
        resolveRouteProtectionDecision({
          meta: { redirectTo },
          defaultRedirectTo: '/auth/signin',
          currentPath: '/dashboard',
        }),
      ).toEqual({ redirectTo: '/auth/signin?redirect=%2Fdashboard' })
    },
  )

  it('never reflects an unsafe return target into the sign-in redirect', () => {
    expect(
      resolveRouteProtectionDecision({
        meta: true,
        defaultRedirectTo: '/auth/signin',
        currentPath: '//evil.example/steal',
        currentFullPath: '//evil.example/steal?token=private',
      }),
    ).toEqual({ redirectTo: '/auth/signin?redirect=%2F' })
  })

  it('normalizes local paths before preserving them', () => {
    expect(
      resolveRouteProtectionDecision({
        meta: true,
        defaultRedirectTo: '/auth/../signin#form',
        currentPath: '/dashboard',
        currentFullPath: '/account/../dashboard?tab=team#members',
      }),
    ).toEqual({
      redirectTo: '/signin?redirect=%2Fdashboard%3Ftab%3Dteam%23members#form',
    })
  })

  it('rejects unsafe object paths without mutating the input', () => {
    const routeTarget = { path: '//evil.example/steal', query: { source: 'guard' } }
    expect(
      resolveRouteProtectionDecision({
        meta: { redirectTo: routeTarget },
        defaultRedirectTo: '/auth/signin',
        currentPath: '/dashboard',
      }),
    ).toEqual({ redirectTo: '/auth/signin?redirect=%2Fdashboard' })
    expect(routeTarget.path).toBe('//evil.example/steal')
  })

  it('protects pages without meta when routes default to protected', () => {
    const input = {
      routes: 'protected' as const,
      defaultRedirectTo: '/auth/signin',
      currentPath: '/dashboard',
    }
    expect(resolveRouteProtectionDecision({ ...input, meta: undefined })).toEqual({
      redirectTo: '/auth/signin?redirect=%2Fdashboard',
    })
    // `convexAuth: false` opts a page out, and the sign-in page never loops.
    expect(resolveRouteProtectionDecision({ ...input, meta: false })).toBeNull()
    expect(
      resolveRouteProtectionDecision({ ...input, meta: undefined, currentPath: '/auth/signin' }),
    ).toBeNull()
    expect(resolveRouteProtectionDecision({ ...input, meta: 'guest' })).toBeNull()
  })

  it('resolves the effective page policy', () => {
    expect(resolveRoutePolicy(undefined)).toBe('public')
    expect(resolveRoutePolicy(undefined, 'protected')).toBe('protected')
    expect(resolveRoutePolicy(false, 'protected')).toBe('public')
    expect(resolveRoutePolicy(true)).toBe('protected')
    expect(resolveRoutePolicy({})).toBe('protected')
    expect(resolveRoutePolicy('guest', 'protected')).toBe('guest')
  })
})

describe('normalizeLocalRedirectPath', () => {
  it('keeps safe local paths and normalizes dot segments', () => {
    expect(normalizeLocalRedirectPath('/dashboard')).toBe('/dashboard')
    expect(normalizeLocalRedirectPath('/team/../dashboard?tab=a#b')).toBe('/dashboard?tab=a#b')
    expect(normalizeLocalRedirectPath('/%252F%252Fdouble')).toBe('/%252F%252Fdouble')
  })

  it.each(OPEN_REDIRECT_VECTORS)('rejects %j', (value) => {
    expect(normalizeLocalRedirectPath(value)).toBeNull()
  })

  it.each([undefined, null, 42, ['/a', '/b'], { path: '/a' }])(
    'rejects non-strings: %j',
    (value) => {
      expect(normalizeLocalRedirectPath(value)).toBeNull()
    },
  )
})

describe('guest-only route redirect', () => {
  it('sends a signed-in visitor to the validated return path', () => {
    expect(
      resolveGuestRedirect({
        returnTo: '/dashboard?tab=team',
        guestRedirectTo: '/',
        currentPath: '/auth/signin',
      }),
    ).toBe('/dashboard?tab=team')
  })

  it('falls back to guestRedirectTo without a return path', () => {
    expect(
      resolveGuestRedirect({ returnTo: undefined, guestRedirectTo: '/app', currentPath: '/login' }),
    ).toBe('/app')
  })

  it.each(OPEN_REDIRECT_VECTORS)('never follows an unsafe return path: %j', (returnTo) => {
    expect(resolveGuestRedirect({ returnTo, guestRedirectTo: '/app', currentPath: '/login' })).toBe(
      '/app',
    )
  })

  it('rejects a repeated redirect parameter as ambiguous', () => {
    expect(
      resolveGuestRedirect({
        returnTo: ['/a', '//evil.example'],
        guestRedirectTo: '/app',
        currentPath: '/login',
      }),
    ).toBe('/app')
  })

  it('never redirects a guest page to itself', () => {
    expect(
      resolveGuestRedirect({ returnTo: '/login?x=1', guestRedirectTo: '/', currentPath: '/login' }),
    ).toBe('/')
    expect(
      resolveGuestRedirect({ returnTo: undefined, guestRedirectTo: '/', currentPath: '/' }),
    ).toBeNull()
  })
})
