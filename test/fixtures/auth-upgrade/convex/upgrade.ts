/*
 * Functions for `pnpm test:auth-upgrade` (scripts/run-auth-upgrade.mjs).
 *
 * `seedBeta` runs against the 1.0.0-beta.7 component schema and stores data
 * exactly as a beta deployment held it. `verifyUpgrade` runs after the normal
 * push of the 1.0 component and throws on the first broken expectation.
 */
import { oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { hashPassword } from 'better-auth/crypto'
import { jwt } from 'better-auth/plugins'
import {
  componentsGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  type FunctionReference,
  type GenericActionCtx,
  type GenericDataModel,
} from 'convex/server'
import { v } from 'convex/values'

import { findAccountKeyCollisions } from '../../../../src/runtime/convex-auth/adapter/account-key-collisions'
import { createConvexAuthAdapter } from '../../../../src/runtime/convex-auth/adapter/create-adapter'
import type { ComponentApi } from '../../../../src/runtime/convex-auth/component/_generated/component'
import { rotateSigningKeyWithOfficialJwt } from '../../../../src/runtime/convex-auth/jwks-rotation'
import { convexAuth } from '../../../../src/runtime/convex-auth/plugin'
import { createConvexAuthRateLimitStorage } from '../../../../src/runtime/convex-auth/rate-limit-storage'

type Row = Record<string, unknown>
type ActionCtx = GenericActionCtx<GenericDataModel>

const component = (
  componentsGeneric() as unknown as {
    betterAuth: ComponentApi<'betterAuth'> & {
      storage: {
        insert: FunctionReference<'mutation', 'internal', { table: string; rows: Row[] }, null>
        rows: FunctionReference<'query', 'internal', { table: string }, Row[]>
      }
    }
  }
).betterAuth
const saveEvidenceRef = makeFunctionReference<'mutation', { snapshot: string }, null>(
  'upgrade:saveEvidence',
)
const readEvidenceRef = makeFunctionReference<'query', Record<string, never>, string>(
  'upgrade:readEvidence',
)

const origin = 'https://app.upgrade.example.test'
const issuer = `${origin}/api/auth`
const resource = 'https://upgrade.example.test/mcp'
const clientId = 'upgrade-mcp-client'
const scopes = ['mcp:read', 'offline_access']
const secret = 'synthetic-auth-upgrade-secret-with-adequate-entropy'
const alicePassword = 'Synthetic beta password 2026'
const betaRefreshToken = 'SyntheticBetaRefreshTokenWithoutConsentBinding'
const currentRefreshToken = 'SyntheticRcRefreshTokenBoundToConsent'

/** Accounts a beta deployment stored with the required `issuer`. */
const betaAccounts = [
  ['account-alice-credential', 'local:credential', 'credential', 'user-alice', 'user-alice'],
  [
    'account-alice-google',
    'https://accounts.google.com',
    'google',
    'google-sub-alice',
    'user-alice',
  ],
  ['account-alice-apple', 'https://appleid.apple.com', 'apple', 'apple-sub-alice', 'user-alice'],
  ['account-bob-github', 'https://github.com', 'github', 'github-id-bob', 'user-bob'],
  // Deliberate collision: one Keycloak subject stored under two issuers
  // (a realm URL change during the beta). Distinct in beta, one key in 1.0.
  [
    'account-carol-keycloak-1',
    'https://sso.example.test/realms/a',
    'keycloak',
    'kc-carol',
    'user-carol',
  ],
  [
    'account-carol-keycloak-2',
    'https://sso.example.test/realms/b',
    'keycloak',
    'kc-carol',
    'user-carol',
  ],
] as const

function fail(check: string, detail?: unknown): never {
  throw new Error(
    `AUTH_UPGRADE_${check}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`,
  )
}

/** JSON with sorted object keys, so equal documents compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
        )
      : item,
  )
}

function expectEqual(check: string, actual: unknown, expected: unknown) {
  if (canonical(actual) !== canonical(expected)) fail(check, { actual, expected })
}

/** The provider stores refresh tokens as unpadded base64url SHA-256 digests. */
async function hashRefreshToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function jwtPayload(token: string): Row {
  const segment = token.split('.')[1] ?? ''
  const base64 = segment.replaceAll('-', '+').replaceAll('_', '/')
  return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as Row
}

/** Every auth table row, in the exact shape the 1.0.0-beta.7 schema required. */
async function betaRows(now: number): Promise<Record<string, Row[]>> {
  const user = (id: string, name: string) => ({
    id,
    name,
    email: `${name.toLowerCase()}@example.test`,
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
    bcnSecurityGeneration: 0,
  })
  const session = (id: string, userId: string) => ({
    id,
    expiresAt: now + 2 * 60 * 60 * 1000,
    token: `beta-${id}-token`,
    createdAt: now,
    updatedAt: now,
    ipAddress: null,
    userAgent: null,
    userId,
    bcnAssuranceGeneration: 0,
  })
  const password = await hashPassword(alicePassword)
  return {
    user: [user('user-alice', 'Alice'), user('user-bob', 'Bob'), user('user-carol', 'Carol')],
    session: [session('session-alice', 'user-alice'), session('session-bob', 'user-bob')],
    account: betaAccounts.map(([id, accountIssuer, providerId, accountId, userId]) => ({
      id,
      issuer: accountIssuer,
      accountId,
      providerId,
      userId,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
      password: providerId === 'credential' ? password : null,
      createdAt: now,
      updatedAt: now,
    })),
    verification: [
      {
        id: 'verification-bob',
        identifier: 'email-verification:bob@example.test',
        value: 'synthetic-verification-value',
        expiresAt: now + 60 * 60 * 1000,
        createdAt: now,
        updatedAt: now,
      },
    ],
    oauthClient: [
      {
        id: 'oauth-client-row',
        clientId,
        clientSecret: null,
        clientDiscoveryId: null,
        disabled: false,
        skipConsent: false,
        enableEndSession: false,
        subjectType: 'public',
        scopes,
        clientCredentialsScopes: null,
        userId: null,
        createdAt: now,
        updatedAt: now,
        name: 'Upgrade MCP host',
        uri: null,
        icon: null,
        contacts: null,
        tos: null,
        policy: null,
        softwareId: null,
        softwareVersion: null,
        softwareStatement: null,
        redirectUris: ['https://host.example.test/oauth/callback'],
        postLogoutRedirectUris: null,
        backchannelLogoutUri: null,
        backchannelLogoutSessionRequired: null,
        tokenEndpointAuthMethod: 'none',
        applicationType: 'native',
        jwks: null,
        jwksUri: null,
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        requirePKCE: true,
        dpopBoundAccessTokens: false,
        referenceId: null,
        metadata: null,
      },
    ],
    oauthResource: [
      {
        id: 'oauth-resource-row',
        identifier: resource,
        name: 'Upgrade MCP resource',
        accessTokenTtl: 600,
        refreshTokenTtl: null,
        signingAlgorithm: 'RS256',
        signingKeyId: null,
        allowedScopes: scopes,
        customClaims: null,
        dpopBoundAccessTokensRequired: false,
        disabled: false,
        createdAt: now,
        updatedAt: now,
        policyVersion: null,
        metadata: null,
      },
    ],
    oauthClientResource: [
      {
        id: 'oauth-client-resource-row',
        clientId,
        resourceId: resource,
        metadata: null,
        createdAt: now,
      },
    ],
    oauthConsent: [
      {
        id: 'consent-alice',
        clientId,
        userId: 'user-alice',
        referenceId: null,
        resources: [resource],
        requestedUserInfoClaims: null,
        scopes,
        createdAt: now,
        updatedAt: now,
      },
    ],
    oauthRefreshToken: [
      {
        id: 'refresh-alice-beta',
        token: await hashRefreshToken(betaRefreshToken),
        clientId,
        sessionId: 'session-alice',
        userId: 'user-alice',
        referenceId: null,
        authorizationCodeId: null,
        resources: [resource],
        requestedUserInfoClaims: null,
        expiresAt: now + 60 * 60 * 1000,
        createdAt: now,
        revoked: null,
        rotatedAt: null,
        rotationReplayResponse: null,
        rotationReplayExpiresAt: null,
        authTime: now,
        confirmation: null,
        scopes,
      },
    ],
    oauthAccessToken: [
      {
        id: 'access-alice-beta',
        token: 'synthetic-beta-opaque-access-token-hash',
        clientId,
        sessionId: 'session-alice',
        userId: 'user-alice',
        referenceId: null,
        authorizationCodeId: null,
        resources: [resource],
        requestedUserInfoClaims: null,
        refreshId: 'refresh-alice-beta',
        expiresAt: now + 10 * 60 * 1000,
        createdAt: now,
        revoked: null,
        confirmation: null,
        scopes,
      },
    ],
    oauthClientAssertion: [{ id: 'client-assertion-beta', expiresAt: now + 60 * 1000 }],
    rateLimit: [
      { id: 'rate-limit-beta', key: '198.51.100.7|/sign-in/email', count: 1, lastRequest: now },
    ],
    // No `jwks` row: the 1.0 deployment provisions its own signing key below.
  }
}

export const saveEvidence = internalMutationGeneric({
  args: { snapshot: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('upgradeEvidence' as never, { snapshot: args.snapshot } as never)
    return null
  },
})

export const readEvidence = internalQueryGeneric({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const rows = (await ctx.db.query('upgradeEvidence' as never).collect()) as Array<{
      snapshot: string
    }>
    if (rows.length !== 1) fail('EVIDENCE_MISSING', rows.length)
    return rows[0]!.snapshot
  },
})

async function snapshot(ctx: ActionCtx, tables: readonly string[]) {
  const result: Record<string, Row[]> = {}
  for (const table of tables) {
    result[table] = await ctx.runQuery(component.storage.rows, { table })
  }
  return result
}

const snapshotTables = [
  'user',
  'session',
  'account',
  'verification',
  'oauthClient',
  'oauthResource',
  'oauthClientResource',
  'oauthConsent',
  'oauthRefreshToken',
  'oauthAccessToken',
  'oauthClientAssertion',
  'rateLimit',
] as const

export const seedBeta = internalActionGeneric({
  args: {},
  handler: async (ctx) => {
    const rows = await betaRows(Date.now())
    for (const [table, tableRows] of Object.entries(rows)) {
      await ctx.runMutation(component.storage.insert, { table, rows: tableRows })
    }
    const stored = await snapshot(ctx, snapshotTables)
    await ctx.runMutation(saveEvidenceRef, { snapshot: JSON.stringify(stored) })
    return Object.fromEntries(Object.entries(stored).map(([table, list]) => [table, list.length]))
  },
})

// The endpoints the canonical OAuth profile disables, as in the provider tests.
const disabledPaths = [
  '/token',
  '/get-access-token',
  '/refresh-token',
  '/.well-known/openid-configuration',
  '/oauth2/register',
  '/oauth2/introspect',
  '/oauth2/userinfo',
  '/oauth2/end-session',
  '/oauth2/create-client',
  '/oauth2/get-client',
  '/oauth2/get-clients',
  '/oauth2/update-client',
  '/oauth2/client/rotate-secret',
  '/oauth2/delete-client',
]

function createAuth(ctx: ActionCtx) {
  const providerOptions = {
    accessTokenExpiresIn: 600,
    allowDynamicClientRegistration: false,
    allowPublicClientPrelogin: true,
    allowUnauthenticatedClientRegistration: false,
    clientPrivileges: async () => true,
    codeExpiresIn: 120,
    consentPage: '/oauth/consent',
    customAccessTokenClaims: async () => ({ token_use: 'oauth-access' }),
    dpop: { signingAlgorithms: [] },
    enforcePerClientResources: true,
    grantTypes: ['authorization_code', 'refresh_token'],
    loginPage: '/login',
    rateLimit: {
      authorize: { max: 30, window: 60 },
      revoke: { max: 30, window: 60 },
      token: { max: 20, window: 60 },
    },
    refreshTokenExpiresIn: 604800,
    refreshTokenReuseInterval: 10,
    resourcePrivileges: async () => true,
    scopes,
    storeClientSecret: 'hashed' as const,
    storeTokens: 'hashed' as const,
  }
  const jwtOptions = {
    disableSettingJwtHeader: true,
    jwks: {
      disablePrivateKeyEncryption: false,
      gracePeriod: 1260,
      keyPairConfig: { alg: 'RS256' as const },
    },
    jwt: { audience: issuer, expirationTime: '10m', issuer },
  }
  const auth = betterAuth<BetterAuthOptions>({
    account: { encryptOAuthTokens: true, storeAccountCookie: false },
    advanced: { ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] } },
    basePath: '/api/auth',
    baseURL: origin,
    database: createConvexAuthAdapter(ctx, component),
    disabledPaths,
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
    plugins: [
      jwt(jwtOptions),
      convexAuth({
        authConfig: {
          providers: [
            {
              type: 'customJwt',
              algorithm: 'RS256',
              applicationID: 'convex',
              issuer: 'https://upgrade.convex.site',
            },
          ],
        },
        oauthProvider: providerOptions,
        sessionJwt: {
          issuer: 'https://upgrade.convex.site',
          audience: 'convex',
          expirationTime: '15m',
        },
      }),
      oauthProvider(providerOptions),
    ],
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'rateLimit',
      customStorage: createConvexAuthRateLimitStorage(ctx, component, 60),
    },
    secret,
    secrets: [{ version: 1, value: secret }],
    trustedOrigins: [origin],
    verification: { storeIdentifier: 'hashed' },
  })
  return { auth, jwtOptions }
}

async function send(
  auth: ReturnType<typeof createAuth>['auth'],
  path: string,
  init: { body?: Row; form?: Record<string, string>; cookie?: string; method?: string } = {},
) {
  const headers: Record<string, string> = { origin, 'x-bcn-verified-client-ip': '192.0.2.1' }
  if (init.cookie) headers.cookie = init.cookie
  let body: string | undefined
  if (init.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(init.form).toString()
  } else if (init.body) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.body)
  }
  const response = await auth.handler(
    new Request(`${issuer}${path}`, { method: init.method ?? 'POST', headers, body }),
  )
  const text = await response.text()
  return {
    status: response.status,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
    body: (text ? JSON.parse(text) : null) as Row | Row[] | null,
  }
}

const refreshGrant = (token: string) => ({
  grant_type: 'refresh_token',
  refresh_token: token,
  client_id: clientId,
  resource,
})

export const verifyUpgrade = internalActionGeneric({
  args: {},
  handler: async (ctx) => {
    const passed: string[] = []
    const before = JSON.parse(await ctx.runQuery(readEvidenceRef, {})) as Record<string, Row[]>

    // The push kept every stored row, including Convex document IDs, as is.
    expectEqual('DATA_CHANGED_BY_PUSH', await snapshot(ctx, snapshotTables), before)
    passed.push('every beta row and Convex document ID is unchanged by the push')

    // Account lookups by the 1.0 key, (providerId, accountId).
    for (const [id, , providerId, accountId, userId] of betaAccounts.slice(0, 4)) {
      const found = (await ctx.runQuery(component.adapter.findOne, {
        model: 'account',
        where: [
          { field: 'providerId', value: providerId },
          { field: 'accountId', value: accountId },
        ],
      })) as Row | null
      expectEqual(`ACCOUNT_LOOKUP:${id}`, found && [found.id, found.userId], [id, userId])
    }
    passed.push('beta accounts are found by their 1.0 key (providerId, accountId)')

    const session = (await ctx.runQuery(component.adapter.findOne, {
      model: 'session',
      where: [{ field: 'token', value: 'beta-session-alice-token' }],
    })) as Row | null
    expectEqual('SESSION_LOOKUP', session?.id, 'session-alice')
    passed.push('beta sessions are found by token')

    // Credential sign-in with the password hash the beta stored.
    const { auth, jwtOptions } = createAuth(ctx)
    const wrong = await send(auth, '/sign-in/email', {
      body: { email: 'alice@example.test', password: 'Not the beta password 2026' },
    })
    expectEqual('WRONG_PASSWORD_ACCEPTED', wrong.status, 401)
    const login = await send(auth, '/sign-in/email', {
      body: { email: 'alice@example.test', password: alicePassword },
    })
    expectEqual(
      'CREDENTIAL_SIGN_IN',
      [login.status, ((login.body as Row | null)?.user as Row | undefined)?.id],
      [200, 'user-alice'],
    )
    const listed = await send(auth, '/list-accounts', { method: 'GET', cookie: login.cookie })
    expectEqual(
      'LIST_ACCOUNTS',
      [listed.status, ((listed.body ?? []) as Row[]).map((account) => account.id).sort()],
      [200, ['account-alice-apple', 'account-alice-credential', 'account-alice-google']],
    )
    if (((listed.body ?? []) as Row[]).some((account) => 'issuer' in account)) {
      fail('LIST_ACCOUNTS_ISSUER')
    }
    passed.push('credential sign-in and linked-account listing work for a beta user')

    // A beta refresh token has no consent binding: denied, nothing minted.
    const refreshRowsBefore = await ctx.runQuery(component.storage.rows, {
      table: 'oauthRefreshToken',
    })
    const betaHash = await hashRefreshToken(betaRefreshToken)
    expectEqual(
      'LEGACY_REFRESH_READABLE',
      await ctx.runQuery(component.adapter.findOne, {
        model: 'oauthRefreshToken',
        where: [{ field: 'token', value: betaHash }],
      }),
      null,
    )
    const denied = await send(auth, '/oauth2/token', { form: refreshGrant(betaRefreshToken) })
    expectEqual(
      'LEGACY_REFRESH_STATUS',
      [denied.status, (denied.body as Row)?.error],
      [400, 'invalid_grant'],
    )
    if ((denied.body as Row)?.access_token || (denied.body as Row)?.refresh_token) {
      fail('LEGACY_REFRESH_MINTED')
    }
    expectEqual(
      'LEGACY_REFRESH_CHANGED_ROWS',
      await ctx.runQuery(component.storage.rows, { table: 'oauthRefreshToken' }),
      refreshRowsBefore,
    )
    passed.push('a beta refresh token is denied with invalid_grant and mints nothing')

    // Control: the same client, consent and beta session renew with a 1.0 token.
    await rotateSigningKeyWithOfficialJwt(await auth.$context, jwtOptions, (next) =>
      ctx.runMutation(component.adapter.rotateSigningKey, { next, onlyIfEmpty: true }),
    )
    const now = Date.now()
    await ctx.runMutation(component.adapter.create, {
      model: 'oauthRefreshToken',
      data: {
        id: 'refresh-alice-rc',
        token: await hashRefreshToken(currentRefreshToken),
        clientId,
        userId: 'user-alice',
        sessionId: 'session-alice',
        resources: [resource],
        scopes,
        createdAt: now,
        expiresAt: now + 60 * 60 * 1000,
      },
    })
    const renewed = await send(auth, '/oauth2/token', { form: refreshGrant(currentRefreshToken) })
    const accessToken = (renewed.body as Row)?.access_token
    if (renewed.status !== 200 || typeof accessToken !== 'string') {
      fail('CURRENT_REFRESH_DENIED', renewed)
    }
    expectEqual('CURRENT_REFRESH_GRANT', jwtPayload(accessToken).bcn_grant_id, 'consent-alice')
    passed.push('a 1.0 refresh token for the same beta client, consent and session renews')

    // findAccountKeyCollisions reports exactly the deliberate collision...
    const report = await findAccountKeyCollisions(ctx, component, { pageSize: 2 })
    expectEqual('COLLISION_REPORT', report, {
      scannedAccounts: 6,
      collisions: [
        {
          providerId: 'keycloak',
          accountId: 'kc-carol',
          accounts: [
            { id: 'account-carol-keycloak-1', userId: 'user-carol' },
            { id: 'account-carol-keycloak-2', userId: 'user-carol' },
          ],
        },
      ],
      isDone: true,
      continueCursor: null,
    })
    passed.push('findAccountKeyCollisions reports the seeded collision and no other account')

    // ...and none once the extra row is removed, as the upgrade guide says.
    await ctx.runMutation(component.adapter.deleteOne, {
      model: 'account',
      where: [{ field: 'id', value: 'account-carol-keycloak-2' }],
    })
    expectEqual('COLLISION_REPORT_AFTER_FIX', await findAccountKeyCollisions(ctx, component, {}), {
      scannedAccounts: 5,
      collisions: [],
      isDone: true,
      continueCursor: null,
    })
    passed.push('findAccountKeyCollisions reports none after the extra row is deleted')

    // No flow above created, re-keyed or replaced a user.
    const users = await ctx.runQuery(component.storage.rows, { table: 'user' })
    expectEqual(
      'USER_IDS_CHANGED',
      users.map((user) => [user._id, user.id]),
      before.user!.map((user) => [user._id, user.id]),
    )
    passed.push('user IDs and Convex document IDs are unchanged after sign-in and renewal')

    return { upgrade: 'passed', checks: passed }
  },
})
