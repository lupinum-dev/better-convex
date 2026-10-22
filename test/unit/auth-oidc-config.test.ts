import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'

const PREFIX = '[better-convex] createBetterConvexAuth '
const OIDC = {
  issuer: 'https://idp.example.test/realms/acme',
  clientId: 'better-convex',
  clientSecret: 'oidc-config-test-secret',
}
const GITHUB = { clientId: 'github-client', clientSecret: 'github-secret' }

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'test-secret'.repeat(4)}`)
  vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
  vi.stubEnv('SITE_URL', 'https://app.example.test')
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
  vi.unstubAllEnvs()
})

function component() {
  const reference = {} as never
  return {
    adapter: {
      consumeOne: reference,
      consumeRateLimit: reference,
      count: reference,
      create: reference,
      deleteMany: reference,
      deleteOne: reference,
      findMany: reference,
      findOne: reference,
      incrementOne: reference,
      rotateSigningKey: reference,
      sessionAdmission: reference,
      updateMany: reference,
      updateOne: reference,
    },
  } as never
}

function build(options: object) {
  return createBetterConvexAuth(component(), { email: async () => {}, ...options } as never)
}

function queryContext() {
  return { runQuery: vi.fn().mockResolvedValue(null) } as never
}

function loggedSubCodes(): unknown[] {
  return consoleError.mock.calls.map(
    (call: unknown[]) => (call[1] as { subCode?: unknown }).subCode,
  )
}

describe('OIDC configuration', () => {
  // Catches: an IdP sign-in that mints a session without the second factor.
  it('rejects twoFactor together with oidc', () => {
    expect(() => build({ twoFactor: {}, oidc: OIDC })).toThrow(
      `${PREFIX}does not support "twoFactor" together with "emailOTP", "socialProviders" or "oidc"; those sign-ins skip the second factor, so remove one of them`,
    )
    expect(() => build({ twoFactor: {}, oidc: () => OIDC })).toThrow(/"oidc"; those sign-ins/)
  })

  // Catches: a hand-written provider named oidc that skips the nonce, PKCE or issuer binding.
  it('rejects socialProviders.oidc', async () => {
    expect(() => build({ socialProviders: { oidc: GITHUB } })).toThrow(
      `${PREFIX}does not support "socialProviders.oidc"; use the "oidc" option`,
    )
    const lazy = build({ socialProviders: () => ({ oidc: GITHUB }) })
    await expect(lazy.createAuth(queryContext())).rejects.toThrow(/^AUTH_CONFIG_INVALID$/)
    expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_OPTIONS_INVALID'])
    expect(JSON.stringify(consoleError.mock.calls)).toContain(
      'does not support \\"socialProviders.oidc\\"',
    )
  })

  // Catches: linking through a trusted oidc that skips the verified-email check (F11).
  it('rejects oidc in trustedProviders', () => {
    for (const options of [{ oidc: OIDC }, { socialProviders: { github: GITHUB } }]) {
      expect(() =>
        build({ ...options, account: { accountLinking: { trustedProviders: ['oidc'] } } }),
      ).toThrow(
        `${PREFIX}does not support "oidc" in "account.accountLinking.trustedProviders"; linking needs email_verified from the identity provider`,
      )
    }
  })

  // Catches: the function form read at module load, before `convex dev` has set the env vars.
  it('accepts the function form without calling it at module load', async () => {
    const oidc = vi.fn(() => {
      if (!process.env.OIDC_ISSUER) throw new Error('OIDC_ISSUER is not set')
      return { ...OIDC, issuer: process.env.OIDC_ISSUER }
    })
    const auth = build({ oidc })
    expect(oidc).not.toHaveBeenCalled()

    vi.stubEnv('OIDC_ISSUER', OIDC.issuer)
    await expect(auth.createAuth(queryContext())).resolves.toBeDefined()
    expect(oidc).toHaveBeenCalledOnce()
  })

  // Catches: a bad function result that passes, or a config error that leaks the secret.
  it('rejects an invalid function result at construction with AUTH_CONFIG_OIDC_INVALID', async () => {
    const auth = build({ oidc: () => ({ ...OIDC, issuer: 'http://idp.example.test/realms/acme' }) })
    await expect(auth.createAuth(queryContext())).rejects.toThrow(/^AUTH_CONFIG_INVALID$/)
    expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_OIDC_INVALID'])
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(OIDC.clientSecret)
  })
})
