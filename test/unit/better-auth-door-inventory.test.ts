import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, relative } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'

// Upgrade guard for the "doors" of sign-in: every way Better Auth can create a session, link or
// delete an account, or change a password or email. The OIDC guards rely on database hooks and on
// `context.path`, so a new door in a Better Auth release must be classified by a maintainer
// before this test passes again. Two snapshots, plus the pinned versions.
//
// When this test fails: open the diff of the failing snapshot, and for each new route or call
// site ask: can it create a session, link or delete an account, or change a password or email?
// If yes, check the guards in src/runtime/convex-auth/oidc-plugin.ts (hooks and `context.path`
// values) and `disabledPaths` in create-better-convex-auth.ts. Then update the literals below.

const nodeModules = join(import.meta.dirname, '../../node_modules')
const FIX_HINT =
  'Classify the new route in the door inventory (can it create a session, link/delete an account, change a password or email?), review the guards in oidc-plugin.ts and disabledPaths, then update the list in test/unit/better-auth-door-inventory.test.ts.'

const REVIEWED_VERSIONS = {
  'better-auth': '1.7.7',
  '@better-auth/core': '1.7.7',
  '@better-auth/oauth-provider': '1.7.7',
}

// Reachable endpoints of an instance with every reviewed option on. twoFactor cannot be combined
// with oidc, emailOTP or anonymous, so it is built apart and only its extra paths are listed.
const REACHABLE_ENDPOINTS: string[] = [
  '/.well-known/oauth-authorization-server',
  '/account-info',
  '/admin/oauth2/resources/:identifier',
  '/admin/oauth2/resources/:identifier/clients/:client_id',
  '/callback/:id',
  '/change-email',
  '/change-password',
  '/convex/token',
  '/delete-anonymous-user',
  '/delete-user',
  '/delete-user/callback',
  '/email-otp/change-email',
  '/email-otp/check-verification-otp',
  '/email-otp/request-email-change',
  '/email-otp/request-password-reset',
  '/email-otp/reset-password',
  '/email-otp/send-verification-otp',
  '/email-otp/verify-email',
  '/error',
  '/forget-password/email-otp',
  '/get-session',
  '/jwks',
  '/link-social',
  '/list-accounts',
  '/list-sessions',
  '/oauth2/authorize',
  '/oauth2/consent',
  '/oauth2/continue',
  '/oauth2/delete-consent',
  '/oauth2/get-consent',
  '/oauth2/get-consents',
  '/oauth2/public-client',
  '/oauth2/public-client-prelogin',
  '/oauth2/revoke',
  '/oauth2/token',
  '/oauth2/update-consent',
  '/ok',
  '/organization/accept-invitation',
  '/organization/cancel-invitation',
  '/organization/check-slug',
  '/organization/create',
  '/organization/delete',
  '/organization/get-active-member',
  '/organization/get-active-member-role',
  '/organization/get-full-organization',
  '/organization/get-invitation',
  '/organization/get-organization',
  '/organization/has-permission',
  '/organization/invite-member',
  '/organization/leave',
  '/organization/list',
  '/organization/list-invitations',
  '/organization/list-members',
  '/organization/list-user-invitations',
  '/organization/reject-invitation',
  '/organization/remove-member',
  '/organization/set-active',
  '/organization/update',
  '/organization/update-member-role',
  '/request-password-reset',
  '/reset-password',
  '/reset-password/:token',
  '/revoke-other-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/send-verification-email',
  '/sign-in/anonymous',
  '/sign-in/email',
  '/sign-in/email-otp',
  '/sign-in/social',
  '/sign-out',
  '/sign-up/email',
  '/unlink-account',
  '/update-session',
  '/update-user',
  '/verify-email',
  '/verify-password',
]
const TWO_FACTOR_ONLY_ENDPOINTS: string[] = [
  '/two-factor/disable',
  '/two-factor/enable',
  '/two-factor/generate-backup-codes',
  '/two-factor/get-totp-uri',
  '/two-factor/send-otp',
  '/two-factor/verify-backup-code',
  '/two-factor/verify-otp',
  '/two-factor/verify-totp',
]

// "<package>/<dist-relative file>" -> call counts; files without calls are left out. Dist chunk
// names carry a content hash (`authorize-K1WHCNih.mjs`): the key drops the hash and sums files
// that share the stripped name.
const CALL_SITES: Record<string, Record<string, number>> = {
  '@better-auth/oauth-provider/authorize.mjs': { deleteSession: 1 },
  'better-auth/api/routes/account.mjs': {
    createAccount: 1,
    deleteAccount: 1,
    updateAccount: 3,
  },
  'better-auth/api/routes/email-verification.mjs': { createSession: 3 },
  'better-auth/api/routes/password.mjs': {
    createAccount: 1,
    deleteUserSessions: 1,
    updatePassword: 1,
  },
  'better-auth/api/routes/session.mjs': {
    deleteSession: 3,
    deleteUserSessions: 1,
  },
  'better-auth/api/routes/sign-in.mjs': { createSession: 1 },
  'better-auth/api/routes/sign-out.mjs': { deleteSession: 1 },
  'better-auth/api/routes/sign-up.mjs': { createSession: 1, linkAccount: 1 },
  'better-auth/api/routes/update-user.mjs': {
    createSession: 1,
    deleteAccounts: 1,
    deleteUser: 2,
    deleteUserSessions: 3,
    linkAccount: 1,
    updateAccount: 2,
  },
  'better-auth/db/revoke-unproven-account-access.mjs': {
    deleteAccount: 1,
    deleteUserSessions: 1,
  },
  'better-auth/oauth2/link-account.mjs': {
    createAccount: 2,
    createSession: 1,
    linkAccount: 1,
    updateAccount: 2,
  },
  'better-auth/plugins/admin/routes.mjs': {
    createAccount: 1,
    createSession: 1,
    deleteSession: 2,
    deleteUser: 1,
    deleteUserSessions: 4,
    linkAccount: 1,
    updatePassword: 1,
  },
  'better-auth/plugins/anonymous/index.mjs': {
    createSession: 1,
    deleteUser: 2,
    deleteUserSessions: 1,
  },
  'better-auth/plugins/device-authorization/routes.mjs': { createSession: 1 },
  'better-auth/plugins/email-otp/routes.mjs': {
    createAccount: 1,
    createSession: 3,
    deleteUserSessions: 1,
    updatePassword: 1,
  },
  'better-auth/plugins/magic-link/index.mjs': { createSession: 1 },
  'better-auth/plugins/multi-session/index.mjs': { deleteSession: 1 },
  'better-auth/plugins/phone-number/routes.mjs': {
    createAccount: 1,
    createSession: 2,
    deleteUserSessions: 1,
    updatePassword: 1,
  },
  'better-auth/plugins/siwe/index.mjs': { createAccount: 2, createSession: 1 },
  'better-auth/plugins/test-utils/auth-helpers.mjs': { createSession: 5 },
  'better-auth/plugins/test-utils/db-helpers.mjs': { deleteUser: 1 },
  'better-auth/plugins/two-factor/index.mjs': {
    createSession: 3,
    deleteSession: 4,
  },
  'better-auth/plugins/two-factor/otp/index.mjs': {
    createSession: 1,
    deleteSession: 1,
  },
  'better-auth/plugins/two-factor/totp/index.mjs': {
    createSession: 1,
    deleteSession: 1,
  },
  'better-auth/plugins/two-factor/verify-two-factor.mjs': { createSession: 1 },
  'better-auth/plugins/username/index.mjs': { createSession: 1 },
}

const DOOR_CALLS = [
  'createSession',
  'deleteSession',
  'deleteUserSessions',
  'deleteAccount',
  'deleteAccounts',
  'deleteUser',
  'linkAccount',
  'createAccount',
  'updatePassword',
  'updateAccount',
] as const

beforeEach(() => {
  vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'door-inventory'.repeat(3)}`)
  vi.stubEnv('BCN_AUTH_PROXY_IP_SECRET', 'door-inventory-proxy-secret-32-bytes')
  vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
  vi.stubEnv('SITE_URL', 'https://app.example.test')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function component() {
  const reference = {} as never
  const names = [
    'consumeOne',
    'consumeRateLimit',
    'count',
    'create',
    'deleteMany',
    'deleteOne',
    'findMany',
    'findOne',
    'incrementOne',
    'rotateSigningKey',
    'sessionAdmission',
    'updateMany',
    'updateOne',
  ]
  return {
    adapter: Object.fromEntries(names.map((name) => [name, reference])),
  } as never
}

async function reachablePaths(options: object): Promise<string[]> {
  const auth = createBetterConvexAuth(component(), {
    email: async () => {},
    emailAndPassword: { passwordReset: true },
    organization: {},
    oauth: { mcp: { scopes: { 'mcp:read': 'Read projects' } } },
    ...options,
  } as never)
  const instance = (await auth.createAuth({
    runQuery: vi.fn().mockResolvedValue(null),
  } as never)) as unknown as {
    api: Record<string, { path?: string }>
    $context: Promise<{ options: { disabledPaths?: string[] } }>
  }
  const disabled = new Set((await instance.$context).options.disabledPaths)
  const paths = Object.values(instance.api).flatMap((endpoint) =>
    endpoint.path !== undefined && !disabled.has(endpoint.path) ? [endpoint.path] : [],
  )
  return [...new Set(paths)].sort()
}

function distFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? distFiles(join(directory, entry.name))
      : entry.name.endsWith('.mjs')
        ? [join(directory, entry.name)]
        : [],
  )
}

function countCallSites(packages: readonly string[]): Record<string, Record<string, number>> {
  const pattern = new RegExp(`\\b(${DOOR_CALLS.join('|')})\\(`, 'g')
  const result: Record<string, Record<string, number>> = {}
  for (const name of packages) {
    const dist = realpathSync(join(nodeModules, name, 'dist'))
    for (const file of distFiles(dist)) {
      const key = `${name}/${relative(dist, file).replace(/-(?=[\w-]*[A-Z])[\w-]{8}\.mjs$/, '.mjs')}`
      for (const [, call] of readFileSync(file, 'utf8').matchAll(pattern)) {
        const counts = (result[key] ??= {})
        counts[call!] = (counts[call!] ?? 0) + 1
      }
    }
  }
  // Sorted keys keep the failure diff readable.
  return Object.fromEntries(
    Object.entries(result)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, counts]) => [key, Object.fromEntries(Object.entries(counts).sort())]),
  )
}

describe('Better Auth door inventory', () => {
  // Catches: a Better Auth upgrade that ships new code with unchanged call counts.
  it('pins the reviewed Better Auth versions', () => {
    const installed = Object.fromEntries(
      Object.keys(REVIEWED_VERSIONS).map((name) => [
        name,
        (
          JSON.parse(readFileSync(join(nodeModules, name, 'package.json'), 'utf8')) as {
            version: string
          }
        ).version,
      ]),
    )
    expect(
      installed,
      'Better Auth was upgraded: re-review the door inventory (routes and call sites below, hooks and context.path guards in oidc-plugin.ts), then update REVIEWED_VERSIONS.',
    ).toEqual(REVIEWED_VERSIONS)
  })

  // Catches: a new Better Auth route that creates a session or changes an account and is
  // reachable without anyone classifying it.
  it('lists exactly the reviewed reachable endpoints', async () => {
    const full = await reachablePaths({
      emailOTP: {},
      oidc: {
        issuer: 'https://idp.example.test/realms/acme',
        clientId: 'x',
        clientSecret: 'y',
      },
      experimental: { anonymous: true },
    })
    const withTwoFactor = await reachablePaths({ twoFactor: {} })
    expect(full, FIX_HINT).toEqual(REACHABLE_ENDPOINTS)
    expect(
      withTwoFactor.filter((path) => !full.includes(path)),
      FIX_HINT,
    ).toEqual(TWO_FACTOR_ONLY_ENDPOINTS)
  })

  // Catches: Better Auth code that creates a session or touches an account from a new place, so
  // a database hook or `context.path` guard no longer sees every door.
  it('counts the reviewed door calls per dist file', () => {
    expect(
      countCallSites(Object.keys(REVIEWED_VERSIONS)),
      'A Better Auth file gained or lost a call that creates a session or changes an account. Review the new call site against the OIDC guards, then update CALL_SITES.',
    ).toEqual(CALL_SITES)
  })
})
