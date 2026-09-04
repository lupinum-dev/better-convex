import { describe, expect, it } from 'vitest'

import { getWorkforceSessionAssurance } from '../../src/runtime/convex-auth/workforce/session-assurance'

const now = 1_000_000
const user = { id: 'user-1', bcnSecurityGeneration: 2 }
const session = {
  id: 'session-1',
  userId: user.id,
  bcnAssuranceGeneration: 2,
  bcnAssuranceMethod: 'password-totp',
  bcnAuthenticatedAt: now - 100,
  bcnSessionStartedAt: now - 500,
  expiresAt: now + 500,
}
const input = { user, session, now, absoluteLifetimeMs: 1_000 }

describe('canonical workforce session assurance', () => {
  it('returns explicit TOTP evidence without mutating canonical inputs', () => {
    const result = getWorkforceSessionAssurance({
      ...input,
      user: Object.freeze({ ...user }),
      session: Object.freeze({ ...session }),
    })
    expect(result).toEqual({
      userId: user.id,
      sessionId: session.id,
      generation: 2,
      authenticatedAt: now - 100,
      sessionStartedAt: now - 500,
      method: 'password-totp',
    })
  })

  it('keeps recovery distinguishable from business-admitted TOTP', () => {
    const result = getWorkforceSessionAssurance({
      ...input,
      session: { ...session, bcnAssuranceMethod: 'password-recovery' },
    })
    expect(result?.method).toBe('password-recovery')
    expect(result?.method === 'password-totp').toBe(false)
  })

  it.each([null, undefined])('rejects absent canonical rows: %s', (missing) => {
    expect(getWorkforceSessionAssurance({ ...input, user: missing })).toBeNull()
    expect(getWorkforceSessionAssurance({ ...input, session: missing })).toBeNull()
  })

  it.each(['none', 'email-otp', 'passkey', 'password', '', undefined, true])(
    'rejects unsupported or missing session method %s',
    (method) => {
      expect(
        getWorkforceSessionAssurance({
          ...input,
          session: { ...session, bcnAssuranceMethod: method },
        }),
      ).toBeNull()
    },
  )

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', undefined])(
    'rejects invalid generations %s on either canonical row',
    (value) => {
      expect(
        getWorkforceSessionAssurance({
          ...input,
          user: { ...user, bcnSecurityGeneration: value },
        }),
      ).toBeNull()
      expect(
        getWorkforceSessionAssurance({
          ...input,
          session: { ...session, bcnAssuranceGeneration: value },
        }),
      ).toBeNull()
    },
  )

  it('accepts the initial generation but rejects generation mismatches', () => {
    expect(
      getWorkforceSessionAssurance({
        ...input,
        user: { ...user, bcnSecurityGeneration: 0 },
        session: { ...session, bcnAssuranceGeneration: 0 },
      })?.generation,
    ).toBe(0)
    expect(
      getWorkforceSessionAssurance({
        ...input,
        user: { ...user, bcnSecurityGeneration: 3 },
      }),
    ).toBeNull()
  })

  it.each(['', null, undefined, 3])('rejects invalid identity %s', (id) => {
    expect(getWorkforceSessionAssurance({ ...input, user: { ...user, id } })).toBeNull()
    expect(getWorkforceSessionAssurance({ ...input, session: { ...session, id } })).toBeNull()
  })

  it('rejects a session belonging to a different user', () => {
    expect(
      getWorkforceSessionAssurance({
        ...input,
        session: { ...session, userId: 'user-2' },
      }),
    ).toBeNull()
  })

  it.each(['bcnAuthenticatedAt', 'bcnSessionStartedAt', 'expiresAt'] as const)(
    'rejects malformed canonical timestamp %s',
    (field) => {
      for (const value of [undefined, null, 0, -1, 1.5, NaN, Infinity, '100', new Date(now)]) {
        expect(
          getWorkforceSessionAssurance({
            ...input,
            session: { ...session, [field]: value },
          }),
        ).toBeNull()
      }
    },
  )

  it('rejects future ceremony/start times and a ceremony preceding its session', () => {
    expect(
      getWorkforceSessionAssurance({
        ...input,
        session: { ...session, bcnAuthenticatedAt: now + 1 },
      }),
    ).toBeNull()
    expect(
      getWorkforceSessionAssurance({
        ...input,
        session: { ...session, bcnSessionStartedAt: now + 1 },
      }),
    ).toBeNull()
    expect(
      getWorkforceSessionAssurance({
        ...input,
        session: { ...session, bcnAuthenticatedAt: now - 501 },
      }),
    ).toBeNull()
  })

  it('uses a half-open canonical expiry boundary', () => {
    for (const expiresAt of [now - 1, now]) {
      expect(
        getWorkforceSessionAssurance({ ...input, session: { ...session, expiresAt } }),
      ).toBeNull()
    }
    expect(
      getWorkforceSessionAssurance({
        ...input,
        session: { ...session, expiresAt: now + 1 },
      }),
    ).not.toBeNull()
  })

  it('uses a half-open absolute lifetime independent of cookie/session refresh', () => {
    expect(getWorkforceSessionAssurance({ ...input, absoluteLifetimeMs: 501 })).not.toBeNull()
    expect(getWorkforceSessionAssurance({ ...input, absoluteLifetimeMs: 500 })).toBeNull()
    expect(
      getWorkforceSessionAssurance({
        ...input,
        absoluteLifetimeMs: 500,
        session: { ...session, expiresAt: now + 100_000, updatedAt: now, createdAt: now },
      }),
    ).toBeNull()
  })

  it('applies optional ceremony freshness without conflating it with absolute lifetime', () => {
    expect(getWorkforceSessionAssurance(input)).not.toBeNull()
    expect(getWorkforceSessionAssurance({ ...input, maxAuthenticationAgeMs: 101 })).not.toBeNull()
    expect(getWorkforceSessionAssurance({ ...input, maxAuthenticationAgeMs: 100 })).toBeNull()
    expect(
      getWorkforceSessionAssurance({
        ...input,
        absoluteLifetimeMs: 500,
        maxAuthenticationAgeMs: 100,
        session: { ...session, bcnAuthenticatedAt: now },
      }),
    ).toBeNull()
  })

  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'fails closed on malformed clock/lifetime policy %s',
    (value) => {
      expect(getWorkforceSessionAssurance({ ...input, now: value })).toBeNull()
      expect(getWorkforceSessionAssurance({ ...input, absoluteLifetimeMs: value })).toBeNull()
      expect(getWorkforceSessionAssurance({ ...input, maxAuthenticationAgeMs: value })).toBeNull()
    },
  )

  it('does not derive evidence from enabled account flags or token/session refresh times', () => {
    expect(
      getWorkforceSessionAssurance({
        ...input,
        user: { ...user, twoFactorEnabled: true, emailVerified: true },
        session: {
          id: session.id,
          userId: user.id,
          expiresAt: session.expiresAt,
          iat: now,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ).toBeNull()
  })
})
