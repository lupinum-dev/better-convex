import { describe, expect, it } from 'vitest'

import { createDevtoolsAuthState } from '../../src/runtime/devtools/auth-diagnostics'

function token(payload: object): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
}

describe('auth DevTools diagnostics', () => {
  it('uses the canonical controller state instead of inferring auth from token presence', () => {
    const state = createDevtoolsAuthState(
      { isAuthenticated: false, pending: true },
      token({ exp: 200, iat: 100, privateClaim: 'must-not-escape' }),
      { id: 'user-1' },
      150,
    )

    expect(state).toEqual({
      expiresAt: 200_000,
      expiresInSeconds: 50,
      isAuthenticated: false,
      issuedAt: 100_000,
      pending: true,
      tokenStatus: 'valid',
      user: { id: 'user-1' },
    })
    expect(JSON.stringify(state)).not.toContain('privateClaim')
  })

  it('reports bounded token expiry without exposing payload claims', () => {
    expect(
      createDevtoolsAuthState(
        { isAuthenticated: true, pending: false },
        token({ exp: 100, role: 'admin' }),
        null,
        101,
      ).tokenStatus,
    ).toBe('expired')
  })
})
