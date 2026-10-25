import { describe, expect, it } from 'vitest'

import { getAuthCookieFlagViolation } from '../../src/runtime/shared/auth-cookie'
import { createRealAuth, useAuthEnvironment } from '../helpers/real-auth'

const EMAIL = 'person@example.test'
const PASSWORD = 'synthetic-password-for-cookies'

describe('cookies the real factory sets', () => {
  useAuthEnvironment()

  // Catches: the Nuxt proxy refusing a cookie Better Auth sets on a normal flow (sign-out
  // would answer 502), or Better Auth starting to set a cookie without HttpOnly.
  it('all pass the Nuxt cookie rule, deletions included', async () => {
    const s = createRealAuth(
      { emailAndPassword: { requireEmailVerification: false }, twoFactor: {} },
      { component: 'twoFactor' },
    )
    const browser = s.client()
    const seen: string[] = []
    const record = (response: { cookies: string[] }) => seen.push(...response.cookies)
    record(await browser.post('/sign-up/email', { name: 'x', email: EMAIL, password: PASSWORD }))
    record(
      await browser.post('/sign-in/email', { email: EMAIL, password: PASSWORD, rememberMe: false }),
    )
    record(await browser.get('/get-session'))
    record(await browser.post('/two-factor/enable', { password: PASSWORD, method: 'otp' }))
    record(await browser.post('/sign-out', {}))
    record(await browser.post('/sign-in/email', { email: EMAIL, password: PASSWORD }))

    const names = new Set(seen.map((cookie) => cookie.split('=', 1)[0]))
    expect([...names].sort()).toEqual(
      expect.arrayContaining([
        '__Secure-better-auth.dont_remember',
        '__Secure-better-auth.session_token',
        '__Secure-better-auth.two_factor',
      ]),
    )
    const violations = seen
      .map((cookie) => [
        cookie.split(';', 1)[0],
        getAuthCookieFlagViolation(cookie, cookie.split('=', 1)[0]!),
      ])
      .filter(([, violation]) => violation !== null)
    expect(violations).toEqual([])
  })
})
