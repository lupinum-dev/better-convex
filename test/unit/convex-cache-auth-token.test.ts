import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchAuthToken } from '../../src/runtime/utils/convex-cache'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// fetchAuthToken performs NO cookie -> JWT exchange. plugin.server.ts
// runs the single per-request exchange before any route component setup and
// keeps the token for that server render; SSR queries receive only that token.

describe('fetchAuthToken', () => {
  it('skips auth entirely when auth mode is none', () => {
    const fetchMock = vi.fn(async () => ({ token: 'jwt-should-not-be-used' }))
    vi.stubGlobal('$fetch', fetchMock)

    const token = fetchAuthToken({
      auth: 'none',
      cookieHeader: 'better-auth.session_token=abc',
      cachedToken: { value: 'plugin.resolved.jwt' },
    })

    expect(token).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the plugin-resolved token when a session cookie is present (no self-exchange)', () => {
    const fetchMock = vi.fn(async () => ({ token: 'jwt-from-exchange' }))
    vi.stubGlobal('$fetch', fetchMock)

    const cachedToken = { value: 'plugin.resolved.jwt' }
    const token = fetchAuthToken({
      auth: 'required',
      cookieHeader: 'private_app_cookie=secret; better-auth.session_token=abc',
      cachedToken,
    })

    // SSR query token === plugin.server token for the same request.
    expect(token).toBe('plugin.resolved.jwt')
    // Never runs a second exchange even though $fetch is available.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('recognizes secure Better Auth session cookies', () => {
    const cachedToken = { value: 'plugin.resolved.secure.jwt' }
    const token = fetchAuthToken({
      auth: 'required',
      cookieHeader: 'private_app_cookie=secret; __Secure-better-auth.session_token=secure-abc',
      cachedToken,
    })

    expect(token).toBe('plugin.resolved.secure.jwt')
  })

  it('returns undefined when a session cookie exists but the plugin resolved no token', () => {
    const fetchMock = vi.fn(async () => ({ token: 'jwt-should-not-be-used' }))
    vi.stubGlobal('$fetch', fetchMock)

    const token = fetchAuthToken({
      auth: 'required',
      cookieHeader: 'better-auth.session_token=abc',
      cachedToken: { value: null },
    })

    expect(token).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns undefined when there is no Better Auth session cookie', () => {
    const token = fetchAuthToken({
      auth: 'required',
      cookieHeader: 'private_app_cookie=secret',
      cachedToken: { value: 'plugin.resolved.jwt' },
    })

    expect(token).toBeUndefined()
  })
})
