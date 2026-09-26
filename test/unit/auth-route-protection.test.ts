import { describe, expect, it } from 'vitest'

import { resolveRouteProtectionDecision } from '../../src/runtime/utils/auth-route-protection'

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

  it.each([
    '//evil.example/steal',
    '/\\evil.example/steal',
    '/%5Cevil.example/steal',
    '/%2F%2Fevil.example/steal',
    'https://evil.example/steal',
    '/safe\nforged',
    '/safe%0d%0aforged',
    '/broken%zz',
  ])('rejects unsafe string redirect targets: %s', (redirectTo) => {
    expect(
      resolveRouteProtectionDecision({
        meta: { redirectTo },
        defaultRedirectTo: '/auth/signin',
        currentPath: '/dashboard',
      }),
    ).toBeNull()
  })

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
    ).toBeNull()
    expect(routeTarget.path).toBe('//evil.example/steal')
  })
})
