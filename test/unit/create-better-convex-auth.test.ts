import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'
import type { PinnedOAuthProviderProfile } from '../../src/runtime/convex-auth/oauth-security'
import { createBetterConvexTestAuth } from '../../src/runtime/convex-auth/test'

const previousEnvironment = {
  BETTER_AUTH_SECRETS: process.env.BETTER_AUTH_SECRETS,
  CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
  SITE_URL: process.env.SITE_URL,
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  process.env.BETTER_AUTH_SECRETS = `0:${'test-secret'.repeat(4)}`
  process.env.CONVEX_SITE_URL = 'https://deployment.convex.site'
  process.env.SITE_URL = 'https://app.example.test'
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
})

function queryContext() {
  return { runQuery: vi.fn().mockResolvedValue(null) }
}

function loggedSubCodes(): unknown[] {
  return consoleError.mock.calls.map(
    (call: unknown[]) => (call[1] as { subCode?: unknown }).subCode,
  )
}

function loggedText(): string {
  return JSON.stringify(consoleError.mock.calls)
}

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

describe('createBetterConvexAuth', () => {
  it.each([
    'plugins',
    'database',
    'databaseHooks',
    'user',
    'advanced',
    'rateLimit',
    'baseURL',
    'basePath',
  ])('rejects an unsafe override of owned option %s', (key) => {
    expect(() => createBetterConvexAuth(component(), { [key]: [] } as never)).toThrow(
      `owns "${key}"`,
    )
  })

  it.each([
    [{ expiresIn: 1 }, 'session.expiresIn'],
    [{ expiresIn: 60 * 60 - 1 }, 'session.expiresIn'],
    [{ expiresIn: 30 * 24 * 60 * 60 + 1 }, 'session.expiresIn'],
    [{ expiresIn: 7200.5 }, 'session.expiresIn'],
    [{ expiresIn: '30d' }, 'session.expiresIn'],
    [{ expiresIn: Number.POSITIVE_INFINITY }, 'session.expiresIn'],
    [{ updateAge: 5 * 60 - 1 }, 'session.updateAge'],
    [{ updateAge: 0 }, 'session.updateAge'],
    [{ expiresIn: 2 * 60 * 60, updateAge: 2 * 60 * 60 + 1 }, 'session.updateAge'],
    [{ updateAge: 8 * 24 * 60 * 60 }, 'session.updateAge'],
    [
      { cookieCache: { enabled: true, maxAge: 10 * 365 * 24 * 60 * 60 } },
      'session.cookieCache.maxAge',
    ],
    [{ cookieCache: { enabled: true, maxAge: 301 } }, 'session.cookieCache.maxAge'],
    [{ cookieCache: { enabled: true, maxAge: 0 } }, 'session.cookieCache.maxAge'],
    [{ cookieCache: { enabled: true, maxAge: 60.5 } }, 'session.cookieCache.maxAge'],
    [{ cookieCache: { enabled: 'yes' } }, 'session.cookieCache.enabled'],
    [{ cookieCache: { enabled: true, strategy: 'plain' } }, 'session.cookieCache.strategy'],
    [{ cookieCache: { enabled: true, refreshCache: true } }, 'session.cookieCache.refreshCache'],
    [{ cookieCache: { enabled: true, version: '2' } }, 'session.cookieCache.version'],
    [{ cookieCache: false }, 'session.cookieCache'],
  ])('rejects session policy %j outside the reviewed bounds', (session, path) => {
    expect(() => createBetterConvexAuth(component(), { session } as never)).toThrow(path)
  })

  const github = { clientId: 'github-client', clientSecret: 'github-secret' }
  const email = async () => {}

  it('refuses BETTER_AUTH_TRUSTED_ORIGINS, which would trust origins next to the verified one', async () => {
    vi.stubEnv('BETTER_AUTH_TRUSTED_ORIGINS', 'https://attacker.example.test')
    try {
      const auth = createBetterConvexAuth(component())
      await expect(auth.createAuth(queryContext() as never)).rejects.toThrow(
        /^AUTH_CONFIG_INVALID$/,
      )
      expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_OPTIONS_INVALID'])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('re-validates trusted providers against lazily resolved social providers', async () => {
    const auth = createBetterConvexAuth(component(), {
      account: { accountLinking: { trustedProviders: ['github'] } },
      socialProviders: () => ({}),
    })
    await expect(auth.createAuth(queryContext() as never)).rejects.toThrow(/^AUTH_CONFIG_INVALID$/)
    expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_OPTIONS_INVALID'])
  })

  it.each([
    [
      'a password verifier',
      { emailAndPassword: { password: { verify: async () => true } } },
      'emailAndPassword.password',
    ],
    [
      'session additional fields',
      { session: { additionalFields: { role: { type: 'string' } } } },
      'session.additionalFields',
    ],
    ['a session fresh age', { session: { freshAge: 0 } }, 'session.freshAge'],
    ['an unknown option', { trustedOrigins: ['*'] }, '"trustedOrigins"'],
    [
      'an unconfigured trusted provider',
      {
        account: { accountLinking: { trustedProviders: ['google'] } },
        socialProviders: { github },
      },
      '"google" is not configured',
    ],
    [
      'email-password as a trusted provider',
      { account: { accountLinking: { trustedProviders: ['email-password'] } } },
      '"email-password" is not configured',
    ],
    [
      'duplicate trusted providers',
      {
        account: { accountLinking: { trustedProviders: ['github', 'github'] } },
        socialProviders: { github },
      },
      'unique provider names',
    ],
    ...[
      { allowDifferentEmails: true },
      { disableImplicitLinking: false },
      { allowUnlinkingAll: true },
      { enabled: false },
    ].map((accountLinking) => [
      `account linking ${JSON.stringify(accountLinking)}`,
      { account: { accountLinking } },
      'account.accountLinking.',
    ]),
    ...[
      { encryptOAuthTokens: false },
      { storeAccountCookie: true },
      { storeStateStrategy: 'cookie' },
    ].map((account) => [`account storage ${JSON.stringify(account)}`, { account }, 'account.']),
    ...[
      ['emailAndPassword', { sendResetPassword: email }],
      ['emailVerification', { sendVerificationEmail: email }],
      ['emailOTP', { sendVerificationOTP: email }],
      ['organization', { sendInvitationEmail: email }],
      ['twoFactor', { otpOptions: { sendOTP: email } }],
    ].map(([key, value]) => [
      `${key} delivery outside the typed email hook`,
      { email, [key as string]: value },
      'deliver auth email through the "email" option',
    ]),
    ...['emailAndPassword', 'emailVerification', 'emailOTP'].map((key) => [
      `a request-scoped ${key} factory`,
      { email, [key]: () => ({}) },
      `expected "${key}" to be an object`,
    ]),
    [
      'email OTP without the email hook',
      { emailOTP: {} },
      'requires the "email" option when "emailOTP" is enabled',
    ],
    [
      'password reset without the email hook',
      { emailAndPassword: { passwordReset: true } },
      'requires the "email" option',
    ],
    [
      'a non-boolean password reset',
      { email, emailAndPassword: { passwordReset: 'yes' } },
      '"emailAndPassword.passwordReset" to be a boolean',
    ],
  ] as Array<[string, object, string]>)('rejects %s at construction', (_name, options, message) => {
    expect(() => createBetterConvexAuth(component(), options as never)).toThrow(message)
  })

  it('sanitizes request-scoped OAuth profile failures', async () => {
    const auth = createBetterConvexAuth(component(), {
      oauthProvider: () => {
        throw new Error('private policy failure')
      },
    })

    await expect(auth.createAuth(queryContext() as never)).rejects.toThrow('AUTH_CONFIG_INVALID')
    await expect(auth.createAuth(queryContext() as never)).rejects.not.toThrow(
      'private policy failure',
    )
    expect(loggedSubCodes()).toEqual([
      'AUTH_CONFIG_OAUTH_PROFILE_FAILED',
      'AUTH_CONFIG_OAUTH_PROFILE_FAILED',
    ])
  })

  it.each([
    '0:short',
    'not-versioned',
    `0:${'a'.repeat(32)},0:${'b'.repeat(32)}`,
    `1:${'a'.repeat(31)},0:${'b'.repeat(32)}`,
  ])('rejects malformed or weak versioned secrets without constructing auth', async (secrets) => {
    process.env.BETTER_AUTH_SECRETS = secrets
    const auth = createBetterConvexAuth(component())

    await expect(auth.createAuth(queryContext() as never)).rejects.toThrow('AUTH_CONFIG_INVALID')
    expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_SECRETS_INVALID'])
    expect(loggedText()).not.toContain(secrets.slice(2))
  })

  it('sanitizes OAuth profile failures in the client deletion operator', async () => {
    const privateFailure = new Error('operator-profile-sentinel')
    const auth = createBetterConvexAuth(component(), {
      oauthProvider: () => Promise.reject(privateFailure),
    })

    const failure = await auth.oauthOperator
      .deleteClient(queryContext() as never, { clientId: 'public-client' })
      .catch((error: unknown) => error)

    expect(failure).toEqual(new Error('AUTH_CONFIG_INVALID'))
    expect(failure).not.toBe(privateFailure)
    expect(String(failure)).not.toContain('operator-profile-sentinel')
    expect(JSON.stringify(failure)).not.toContain('operator-profile-sentinel')
    expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_OAUTH_PROFILE_FAILED'])
  })
})

describe('site origins configuration', () => {
  const SITE_B = 'https://site-b.example.test'

  it('rejects an invalid list and the OAuth provider combination at construction', () => {
    expect(() =>
      createBetterConvexAuth(component(), { siteOrigins: ['https://site.test/path'] }),
    ).toThrow()
    expect(() =>
      createBetterConvexAuth(component(), { siteOrigins: 'https://site.test' as never }),
    ).toThrow('"siteOrigins"')
    expect(() =>
      createBetterConvexAuth(component(), { siteOrigins: ['https://*.example.test'] }),
    ).toThrow('without "*"')
    expect(() =>
      createBetterConvexAuth(component(), {
        siteOrigins: [SITE_B],
        oauthProvider: {} as PinnedOAuthProviderProfile,
      }),
    ).toThrow('"siteOrigins" together with "oauth"')
  })
})

describe('createBetterConvexTestAuth', () => {
  it.each([
    ['SITE_URL', 'https://localhost'],
    ['SITE_URL', 'http://example.test'],
    ['SITE_URL', 'http://localhost/path'],
    ['CONVEX_SITE_URL', 'https://127.0.0.1'],
    ['CONVEX_SITE_URL', 'http://user@localhost'],
  ] as const)('rejects non-loopback %s value %s', (name, value) => {
    process.env.SITE_URL = 'http://localhost:3000'
    process.env.CONVEX_SITE_URL = 'http://127.0.0.1:3211'
    process.env[name] = value

    expect(() => createBetterConvexTestAuth(component(), {})).toThrow('AUTH_TEST_LOOPBACK_REQUIRED')
  })

  it('revalidates loopback origins for every auth construction', async () => {
    process.env.SITE_URL = 'http://localhost:3000'
    process.env.CONVEX_SITE_URL = 'http://127.0.0.1:3211'
    const auth = createBetterConvexTestAuth(component(), {})
    process.env.SITE_URL = 'https://app.example.test'

    await expect(auth.createAuth(queryContext() as never)).rejects.toThrow('AUTH_CONFIG_INVALID')
  })
})
