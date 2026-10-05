/// <reference types="vite/client" />
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { hashPassword } from 'better-auth/crypto'
import { validate } from 'convex-helpers/validators'
import { convexTest } from 'convex-test'
import {
  componentsGeneric,
  defineSchema,
  defineTable,
  mutationGeneric,
  queryGeneric,
  type FunctionReference,
  type GenericActionCtx,
  type GenericDataModel,
} from 'convex/server'
import { v, type PropertyValidators } from 'convex/values'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findAccountKeyCollisions } from '../../src/runtime/convex-auth/adapter/account-key-collisions'
import { createConvexAuthAdapter } from '../../src/runtime/convex-auth/adapter/create-adapter'
import {
  assertAuthSchemaMatchesMetadata,
  fingerprintAuthSchemaModels,
} from '../../src/runtime/convex-auth/adapter/metadata'
import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema, { tables } from '../../src/runtime/convex-auth/component/schema'
import authSchemaMetadata from '../../src/runtime/convex-auth/component/schemaMetadata'
import beta7Schema from '../fixtures/auth-upgrade/beta7/schema'

/*
 * Better Convex 1.0.0-beta.1 through beta.7 ran Better Auth 1.7.1/1.7.2 and
 * stored every account with a required `issuer`, unique with `accountId`.
 * These rows are written exactly as that release stored them, into the
 * component governed by the current generated schema: Convex validates each
 * existing document against the pushed schema, which is the check a
 * deployment upgrade performs. No export or import is involved.
 */

const rootModules = import.meta.glob('../fixtures/jwks-rotation/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const componentRoot = Object.keys(authModules)
  .find((path) => path.includes('/_generated/'))!
  .split('_generated')[0]!

// Raw storage access, standing in for data a beta deployment already holds.
const betaStorage = {
  insert: mutationGeneric({
    args: { table: v.string(), row: v.any() },
    returns: v.null(),
    handler: async (ctx, args) => {
      await ctx.db.insert(args.table as never, args.row as never)
      return null
    },
  }),
  rows: queryGeneric({
    args: { table: v.string() },
    returns: v.any(),
    handler: async (ctx, args) =>
      (await ctx.db.query(args.table as never).collect()).map(
        ({ _id, _creationTime, ...row }: Record<string, unknown>) => row,
      ),
  }),
}

const components = componentsGeneric() as unknown as {
  betaUpgrade: ComponentApi<'betaUpgrade'> & {
    betaStorage: {
      insert: FunctionReference<'mutation', 'internal', { table: string; row: unknown }, null>
      rows: FunctionReference<'query', 'internal', { table: string }, Record<string, unknown>[]>
    }
  }
}
const component = components.betaUpgrade

// The account table of the published 1.0.0-beta.7 component schema.
const betaAccount = v.object({
  id: v.string(),
  issuer: v.string(),
  accountId: v.string(),
  providerId: v.string(),
  userId: v.string(),
  accessToken: v.union(v.null(), v.string()),
  refreshToken: v.union(v.null(), v.string()),
  idToken: v.union(v.null(), v.string()),
  accessTokenExpiresAt: v.union(v.null(), v.number()),
  refreshTokenExpiresAt: v.union(v.null(), v.number()),
  scope: v.union(v.null(), v.string()),
  password: v.union(v.null(), v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

const now = 1_700_000_000_000
const origin = 'https://app.example.test'
const secret = 'synthetic-beta-upgrade-secret-with-adequate-entropy'
const alicePassword = 'Synthetic beta password 2026'

interface Profile {
  sub: string
  email: string
  name: string
}

// Id tokens are opaque test handles; verification is replaced below.
const profiles: Record<string, Profile> = {
  'google-alice': { sub: 'google-sub-alice', email: 'alice@example.test', name: 'Alice' },
  'apple-alice': { sub: 'apple-sub-alice', email: 'alice@example.test', name: 'Alice' },
  'google-bob': { sub: 'google-sub-bob', email: 'bob@example.test', name: 'Bob' },
  'google-carol': { sub: 'google-sub-carol', email: 'carol@example.test', name: 'Carol' },
}

function socialProvider() {
  return {
    clientId: 'synthetic-client',
    clientSecret: 'synthetic-client-secret',
    verifyIdToken: async () => true,
    getUserInfo: async (tokens: { idToken?: string }) => {
      const profile = tokens.idToken ? profiles[tokens.idToken] : undefined
      return profile
        ? {
            user: { name: profile.name, email: profile.email, emailVerified: true },
            // Providers read the account subject from the profile's `sub`.
            data: profile as never,
          }
        : null
    },
  }
}

function createAuth(ctx: GenericActionCtx<GenericDataModel>) {
  return betterAuth<BetterAuthOptions>({
    baseURL: origin,
    basePath: '/api/auth',
    secret,
    secrets: [{ version: 1, value: secret }],
    database: createConvexAuthAdapter(ctx, component),
    emailAndPassword: { enabled: true },
    socialProviders: { google: socialProvider(), apple: socialProvider() },
    account: { encryptOAuthTokens: true, storeAccountCookie: false },
    advanced: { ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] } },
    logger: { disabled: true },
    rateLimit: { enabled: false },
    trustedOrigins: [origin],
  })
}

function betaUser(id: string, email: string, name: string) {
  return {
    id,
    name,
    email,
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
    bcnSecurityGeneration: 0,
  }
}

function betaAccountRow(row: {
  id: string
  issuer: string
  providerId: string
  accountId: string
  userId: string
  password?: string
}) {
  return {
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: null,
    password: null,
    createdAt: now,
    updatedAt: now,
    ...row,
  }
}

async function betaAccounts() {
  return [
    // Alice signed up with a password, then linked Google and Apple.
    betaAccountRow({
      id: 'account-alice-credential',
      issuer: 'local:credential',
      providerId: 'credential',
      accountId: 'user-alice',
      userId: 'user-alice',
      password: await hashPassword(alicePassword),
    }),
    betaAccountRow({
      id: 'account-alice-google',
      issuer: 'https://accounts.google.com',
      providerId: 'google',
      accountId: 'google-sub-alice',
      userId: 'user-alice',
    }),
    betaAccountRow({
      id: 'account-alice-apple',
      issuer: 'https://appleid.apple.com',
      providerId: 'apple',
      accountId: 'apple-sub-alice',
      userId: 'user-alice',
    }),
    // Bob only ever signed in with Google.
    betaAccountRow({
      id: 'account-bob-google',
      issuer: 'https://accounts.google.com',
      providerId: 'google',
      accountId: 'google-sub-bob',
      userId: 'user-bob',
    }),
  ]
}

async function init(extraAccounts: Record<string, unknown>[] = []) {
  const test = convexTest(defineSchema({}), rootModules)
  test.registerComponent('betaUpgrade', authSchema, {
    ...authModules,
    [`${componentRoot}betaStorage.ts`]: async () => betaStorage,
  })
  const users = [
    betaUser('user-alice', 'alice@example.test', 'Alice'),
    betaUser('user-bob', 'bob@example.test', 'Bob'),
    betaUser('user-carol', 'carol@example.test', 'Carol'),
  ]
  const accounts = [...(await betaAccounts()), ...extraAccounts]
  for (const row of accounts) {
    // Each seeded row is one the beta schema accepted.
    expect(validate(betaAccount, row)).toBe(true)
  }
  for (const row of users) {
    await test.mutation(component.betaStorage.insert, { table: 'user', row })
  }
  for (const row of accounts) {
    await test.mutation(component.betaStorage.insert, { table: 'account', row })
  }

  const send = (path: string, init: { body?: unknown; cookie?: string; method?: string } = {}) =>
    test.action(async (ctx) => {
      const response = await createAuth(ctx).handler(
        new Request(`${origin}/api/auth${path}`, {
          method: init.method ?? 'POST',
          headers: {
            origin,
            'x-bcn-verified-client-ip': '192.0.2.1',
            ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(init.cookie ? { cookie: init.cookie } : {}),
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
      )
      const text = await response.text()
      return {
        status: response.status,
        cookie: response.headers.get('set-cookie')?.split(';')[0],
        body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
      }
    })
  const socialSignIn = (provider: 'google' | 'apple', token: string) =>
    send('/sign-in/social', { body: { provider, idToken: { token } } })
  const rawAccounts = async () =>
    (await test.query(component.betaStorage.rows, { table: 'account' })).sort((left, right) =>
      String(left.id).localeCompare(String(right.id)),
    )
  return { test, send, socialSignIn, rawAccounts }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now + 60_000)
})
afterEach(() => vi.useRealTimers())

describe('beta account rows under the 1.0 account identity', () => {
  it('keeps every beta account id, owner and provider link readable', async () => {
    const { test } = await init()
    for (const expected of await betaAccounts()) {
      const row = await test.query(component.adapter.findOne, {
        model: 'account',
        where: [
          { field: 'providerId', value: expected.providerId },
          { field: 'accountId', value: expected.accountId },
        ],
      })
      expect(row).toMatchObject({
        id: expected.id,
        providerId: expected.providerId,
        accountId: expected.accountId,
        userId: expected.userId,
      })
    }
  })

  it('signs in a beta credential account with its existing password', async () => {
    const { send, rawAccounts } = await init()
    const before = await rawAccounts()
    const login = await send('/sign-in/email', {
      body: { email: 'alice@example.test', password: alicePassword },
    })

    expect(login.status, JSON.stringify(login.body)).toBe(200)
    expect(login.body?.user).toMatchObject({ id: 'user-alice' })
    expect(await rawAccounts()).toEqual(before)
  })

  it('signs in through both linked social providers onto the same beta rows', async () => {
    const { socialSignIn, rawAccounts } = await init()
    const before = await rawAccounts()

    for (const [provider, token, userId] of [
      ['google', 'google-alice', 'user-alice'],
      ['apple', 'apple-alice', 'user-alice'],
      ['google', 'google-bob', 'user-bob'],
    ] as const) {
      const login = await socialSignIn(provider, token)
      expect(login.status, JSON.stringify(login.body)).toBe(200)
      expect(login.body?.user).toMatchObject({ id: userId })
    }

    const after = await rawAccounts()
    // No account was added or re-keyed, and the retired issuer was never rewritten.
    const keys = (rows: Record<string, unknown>[]) =>
      rows.map(({ id, providerId, accountId, userId, issuer }) => ({
        id,
        providerId,
        accountId,
        userId,
        issuer,
      }))
    expect(keys(after)).toEqual(keys(before))
    // The linked-account refresh on sign-in did write through the adapter.
    expect(after.find((row) => row.id === 'account-alice-google')?.idToken).toMatch(/^\$ba\$/u)
  })

  it('lists the linked providers of a beta user without the retired issuer', async () => {
    const { send } = await init()
    const login = await send('/sign-in/email', {
      body: { email: 'alice@example.test', password: alicePassword },
    })
    expect(login.status).toBe(200)
    const listed = await send('/list-accounts', { method: 'GET', cookie: login.cookie })

    expect(listed.status, JSON.stringify(listed.body)).toBe(200)
    const accounts = listed.body as unknown as Record<string, unknown>[]
    expect(
      accounts.map(({ id, providerId, accountId }) => ({ id, providerId, accountId })),
    ).toEqual(
      expect.arrayContaining([
        { id: 'account-alice-credential', providerId: 'credential', accountId: 'user-alice' },
        { id: 'account-alice-google', providerId: 'google', accountId: 'google-sub-alice' },
        { id: 'account-alice-apple', providerId: 'apple', accountId: 'apple-sub-alice' },
      ]),
    )
    expect(accounts).toHaveLength(3)
    for (const account of accounts) expect(account).not.toHaveProperty('issuer')
  })

  it('never lets the adapter write, filter or select the retired issuer', async () => {
    const { test } = await init()
    await expect(
      test.mutation(component.adapter.create, {
        model: 'account',
        data: {
          ...betaAccountRow({
            id: 'account-new',
            issuer: 'https://accounts.google.com',
            providerId: 'google',
            accountId: 'google-sub-new',
            userId: 'user-bob',
          }),
        },
      }),
    ).rejects.toThrow('AUTH_FIELD_UNKNOWN:account.issuer')
    await expect(
      test.mutation(component.adapter.updateOne, {
        model: 'account',
        where: [{ field: 'id', value: 'account-bob-google' }],
        update: { issuer: 'https://evil.example.test' },
      }),
    ).rejects.toThrow('AUTH_FIELD_UNKNOWN:account.issuer')
    await expect(
      test.query(component.adapter.findOne, {
        model: 'account',
        where: [{ field: 'issuer', value: 'https://accounts.google.com' }],
      }),
    ).rejects.toThrow('AUTH_FIELD_UNKNOWN:account.issuer')
    await expect(
      test.query(component.adapter.findOne, {
        model: 'account',
        where: [{ field: 'id', value: 'account-bob-google' }],
        select: ['issuer'],
      }),
    ).rejects.toThrow('AUTH_FIELD_UNKNOWN:account.issuer')
  })
})

describe('findAccountKeyCollisions', () => {
  // Carol's Google subject was stored under two issuers, e.g. after an
  // accountIssuer configuration change: distinct keys in beta, one key in 1.0.
  const carolCollision = [
    betaAccountRow({
      id: 'account-carol-google-1',
      issuer: 'https://accounts.google.com',
      providerId: 'google',
      accountId: 'google-sub-carol',
      userId: 'user-carol',
    }),
    betaAccountRow({
      id: 'account-carol-google-2',
      issuer: 'accounts.google.com',
      providerId: 'google',
      accountId: 'google-sub-carol',
      userId: 'user-carol',
    }),
  ]

  it('reports no collision for a beta dataset with one issuer per provider', async () => {
    const { test } = await init()
    const report = await test.action((ctx) =>
      findAccountKeyCollisions(ctx, component, { pageSize: 2 }),
    )
    expect(report).toEqual({
      scannedAccounts: 4,
      collisions: [],
      isDone: true,
      continueCursor: null,
    })
  })

  it('finds beta rows that collide under (providerId, accountId), across page boundaries', async () => {
    const { test } = await init(carolCollision)
    for (const pageSize of [1, 2, 3, 100]) {
      const report = await test.action((ctx) =>
        findAccountKeyCollisions(ctx, component, { pageSize }),
      )
      expect(report).toEqual({
        scannedAccounts: 6,
        collisions: [
          {
            providerId: 'google',
            accountId: 'google-sub-carol',
            accounts: [
              { id: 'account-carol-google-1', userId: 'user-carol' },
              { id: 'account-carol-google-2', userId: 'user-carol' },
            ],
          },
        ],
        isDone: true,
        continueCursor: null,
      })
    }
  })

  it('resumes across bounded calls and still reports a collision split between them', async () => {
    const { test } = await init(carolCollision)
    for (const pageSize of [1, 2]) {
      const collisions: unknown[] = []
      let scanned = 0
      let calls = 0
      let cursor: string | null = null
      while (true) {
        const report: Awaited<ReturnType<typeof findAccountKeyCollisions>> = await test.action(
          (ctx) => findAccountKeyCollisions(ctx, component, { pageSize, maxPages: 1, cursor }),
        )
        calls += 1
        scanned += report.scannedAccounts
        collisions.push(...report.collisions)
        if (report.isDone) break
        cursor = report.continueCursor
      }
      expect(calls).toBeGreaterThan(1)
      expect(scanned).toBe(6)
      expect(collisions).toEqual([
        {
          providerId: 'google',
          accountId: 'google-sub-carol',
          accounts: [
            { id: 'account-carol-google-1', userId: 'user-carol' },
            { id: 'account-carol-google-2', userId: 'user-carol' },
          ],
        },
      ])
    }
  })

  it('shows why the check matters: a colliding identity cannot sign in', async () => {
    const single = await init(carolCollision.slice(0, 1))
    expect((await single.socialSignIn('google', 'google-carol')).status).toBe(200)

    const { socialSignIn, rawAccounts } = await init(carolCollision)
    const before = await rawAccounts()
    const login = await socialSignIn('google', 'google-carol')

    expect(login.status).not.toBe(200)
    expect(login.body?.token).toBeUndefined()
    expect(await rawAccounts()).toEqual(before)
  })

  it('rejects page sizes that would exceed one bounded component query', async () => {
    const { test } = await init()
    for (const pageSize of [0, 101, 1.5]) {
      await expect(
        test.action((ctx) => findAccountKeyCollisions(ctx, component, { pageSize })),
      ).rejects.toThrow('AUTH_ACCOUNT_SCAN_PAGE_SIZE_INVALID')
    }
  })
})

describe('every 1.0.0-beta.7 auth document under the 1.0 schema', () => {
  type ExportedFields = Record<string, { fieldType: unknown; optional: boolean }>
  const documentFields = (schema: unknown) =>
    new Map(
      (
        JSON.parse((schema as { export(): string }).export()) as {
          tables: Array<{ tableName: string; documentType: { value: ExportedFields } }>
        }
      ).tables.map((table) => [table.tableName, table.documentType.value]),
    )

  it('accepts every beta field with its beta type and requires no new field', () => {
    // A schema push validates every stored document. This holds for each
    // table exactly when the push needs no export, import or manual clearing.
    const beta = documentFields(beta7Schema)
    const current = documentFields(authSchema)
    for (const [table, betaFields] of beta) {
      const fields = current.get(table)
      expect(fields, table).toBeDefined()
      for (const [name, field] of Object.entries(betaFields)) {
        expect(fields![name]?.fieldType, `${table}.${name}`).toEqual(field.fieldType)
      }
      for (const [name, field] of Object.entries(fields!)) {
        if (!field.optional) expect(betaFields[name], `${table}.${name}`).toBeDefined()
      }
    }
    expect(current.get('oauthRefreshToken')?.bcnConsentId).toEqual({
      fieldType: { type: 'union', value: [{ type: 'null' }, { type: 'string' }] },
      optional: true,
    })
  })

  it('keeps the optional consent binding immutable and pinned to the adapter metadata', () => {
    expect(authSchemaMetadata.models.oauthRefreshToken.fields.bcnConsentId).toMatchObject({
      nullable: true,
      optional: true,
      updatable: false,
    })
    const { bcnConsentId: _bcnConsentId, ...fields } = tables.oauthRefreshToken.validator.fields
    const withRefreshFields = (refreshFields: PropertyValidators) => {
      let table = defineTable(refreshFields) as unknown as {
        index(name: string, fields: string[]): typeof table
      }
      for (const index of authSchemaMetadata.models.oauthRefreshToken.indexes) {
        table = table.index(index.descriptor, [...index.fields])
      }
      const schema = defineSchema({
        ...tables,
        oauthRefreshToken: table as unknown as typeof tables.oauthRefreshToken,
      })
      Object.defineProperty(schema, '__betterConvexNuxtAuthSchemaFingerprint', {
        value: fingerprintAuthSchemaModels(authSchemaMetadata.models),
      })
      return schema
    }
    expect(() =>
      assertAuthSchemaMatchesMetadata(
        withRefreshFields({ ...fields, bcnConsentId: v.optional(v.union(v.null(), v.string())) }),
        authSchemaMetadata,
      ),
    ).not.toThrow()
    for (const variant of [
      { ...fields, bcnConsentId: v.union(v.null(), v.string()) },
      { ...fields, bcnConsentId: v.optional(v.string()) },
      fields,
    ]) {
      expect(() =>
        assertAuthSchemaMatchesMetadata(withRefreshFields(variant), authSchemaMetadata),
      ).toThrow('AUTH_SCHEMA_METADATA_MISMATCH')
    }
  })
})
