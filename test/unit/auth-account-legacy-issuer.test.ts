import type { BetterAuthDBSchema } from 'better-auth/db'
import { defineSchema, defineTable } from 'convex/server'
import { v, type PropertyValidators } from 'convex/values'
import { describe, expect, it } from 'vitest'

import { findAccountKeyCollisions } from '../../src/runtime/convex-auth/adapter/account-key-collisions'
import { generateAuthSchemaArtifacts } from '../../src/runtime/convex-auth/adapter/generate-schema'
import {
  assertAuthSchemaMatchesMetadata,
  fingerprintAuthSchemaModels,
  type AuthSchemaMetadata,
} from '../../src/runtime/convex-auth/adapter/metadata'
import packagedSchema, { tables } from '../../src/runtime/convex-auth/component/schema'
import packagedSchemaMetadata from '../../src/runtime/convex-auth/component/schemaMetadata'
import teamSchema from '../../starters/team/convex/betterAuth/schema'
import teamSchemaMetadata from '../../starters/team/convex/betterAuth/schemaMetadata'
import localComponentSchema from '../fixtures/better-auth-local-component/convex/betterAuth/schema'
import localComponentSchemaMetadata from '../fixtures/better-auth-local-component/convex/betterAuth/schemaMetadata'
import twoFactorSchema from '../fixtures/better-auth-two-factor/convex/betterAuth/schema'
import twoFactorSchemaMetadata from '../fixtures/better-auth-two-factor/convex/betterAuth/schemaMetadata'

interface ExportedField {
  fieldType: unknown
  optional: boolean
}

function exportedTable(schema: unknown, name: string) {
  const exported = JSON.parse((schema as { export(): string }).export()) as {
    tables: Array<{
      tableName: string
      documentType: { value: Record<string, ExportedField> }
      indexes: Array<{ fields: string[] }>
    }>
  }
  const table = exported.tables.find((candidate) => candidate.tableName === name)
  if (!table) throw new Error(`Expected table ${name}`)
  return table
}

// The account table of every published 1.0.0-beta component (beta.1-beta.7).
const betaAccount = defineTable({
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
  .index('id', ['id'])
  .index('issuer_accountId', ['issuer', 'accountId'])
  .index('userId', ['userId'])
  .index('createdAt', ['createdAt'])

const generatedComponents = [
  ['packaged component', packagedSchema, packagedSchemaMetadata],
  ['team starter', teamSchema, teamSchemaMetadata],
  ['local component fixture', localComponentSchema, localComponentSchemaMetadata],
  ['two-factor fixture', twoFactorSchema, twoFactorSchemaMetadata],
] as const

function withFingerprint(
  schema: object,
  models: AuthSchemaMetadata['models'],
): { schema: object; metadata: AuthSchemaMetadata } {
  const fingerprint = fingerprintAuthSchemaModels(models)
  Object.defineProperty(schema, '__betterConvexNuxtAuthSchemaFingerprint', { value: fingerprint })
  return { schema, metadata: { fingerprint, models } }
}

function accountModels(
  change: (account: Record<string, unknown>) => void,
): AuthSchemaMetadata['models'] {
  const models = structuredClone(packagedSchemaMetadata) as unknown as {
    models: Record<string, Record<string, unknown>>
  }
  change(models.models.account!)
  return models.models as unknown as AuthSchemaMetadata['models']
}

describe('retired Better Auth 1.7.0-1.7.2 account issuer', () => {
  it.each(generatedComponents)(
    'keeps issuer optional and outside adapter metadata in the %s',
    (_label, schema, metadata) => {
      const account = (metadata as AuthSchemaMetadata).models.account!
      expect(account.legacyFields).toEqual({ issuer: 'string' })
      expect(account.fields).not.toHaveProperty('issuer')
      expect(account.indexes.some((index) => index.fields.includes('issuer'))).toBe(false)

      const table = exportedTable(schema, 'account')
      expect(table.documentType.value.issuer).toEqual({
        fieldType: { type: 'string' },
        optional: true,
      })
      expect(table.indexes.some((index) => index.fields.includes('issuer'))).toBe(false)
      expect(() => assertAuthSchemaMatchesMetadata(schema, metadata)).not.toThrow()
    },
  )

  it.each(generatedComponents)(
    'accepts every document the beta account table accepted in the %s',
    (_label, schema) => {
      const current = exportedTable(schema, 'account').documentType.value
      const beta = exportedTable(defineSchema({ account: betaAccount }), 'account').documentType
        .value

      // A push validates existing documents: every beta field must still be
      // accepted with its beta type, and no new field may be required.
      for (const [name, field] of Object.entries(beta)) {
        expect(current[name]?.fieldType, name).toEqual(field.fieldType)
      }
      for (const [name, field] of Object.entries(current)) {
        if (!field.optional) expect(beta[name], name).toBeDefined()
      }
    },
  )

  it('rejects a schema whose legacy column is required, nullable or missing', () => {
    const { issuer: _issuer, ...accountFields } = tables.account.validator.fields
    const account = (fields: PropertyValidators) => {
      let table = defineTable(fields) as unknown as {
        index(name: string, fields: string[]): typeof table
      }
      for (const index of packagedSchemaMetadata.models.account.indexes) {
        table = table.index(index.descriptor, [...index.fields])
      }
      return defineSchema({ ...tables, account: table as unknown as typeof tables.account })
    }
    const variants = {
      required: account({ ...accountFields, issuer: v.string() }),
      nullable: account({ ...accountFields, issuer: v.optional(v.union(v.null(), v.string())) }),
      missing: account(accountFields),
    }
    const control = withFingerprint(
      account({ ...accountFields, issuer: v.optional(v.string()) }),
      packagedSchemaMetadata.models,
    )
    expect(() => assertAuthSchemaMatchesMetadata(control.schema, control.metadata)).not.toThrow()
    for (const [label, variant] of Object.entries(variants)) {
      const { schema, metadata } = withFingerprint(variant, packagedSchemaMetadata.models)
      expect(() => assertAuthSchemaMatchesMetadata(schema, metadata), label).toThrow(
        'AUTH_SCHEMA_METADATA_MISMATCH',
      )
    }

    const undeclared = withFingerprint(
      defineSchema(tables),
      accountModels((account) => delete account.legacyFields),
    )
    expect(() => assertAuthSchemaMatchesMetadata(undeclared.schema, undeclared.metadata)).toThrow(
      'AUTH_SCHEMA_METADATA_MISMATCH',
    )
  })

  it('generates the optional column and fails closed if Better Auth defines issuer again', () => {
    const accountTables = {
      user: { modelName: 'user', fields: { email: { type: 'string', required: true } } },
      account: {
        modelName: 'account',
        fields: {
          providerId: { type: 'string', required: true },
          accountId: { type: 'string', required: true },
          userId: {
            type: 'string',
            required: true,
            references: { model: 'user', field: 'id', onDelete: 'cascade' },
          },
        },
      },
    } as unknown as BetterAuthDBSchema

    const artifacts = generateAuthSchemaArtifacts(accountTables)
    expect(artifacts.metadata.models.account?.legacyFields).toEqual({ issuer: 'string' })
    expect(artifacts.metadata.models.user).not.toHaveProperty('legacyFields')
    expect(artifacts.schemaCode).toContain('    issuer: v.optional(v.string()),\n')

    const reintroduced = structuredClone(accountTables) as unknown as {
      account: { fields: Record<string, unknown> }
    }
    reintroduced.account.fields.issuer = { type: 'string', required: true }
    expect(() =>
      generateAuthSchemaArtifacts(reintroduced as unknown as BetterAuthDBSchema),
    ).toThrow('AUTH_SCHEMA_LEGACY_FIELD_COLLISION:account.issuer')
  })
})

describe('findAccountKeyCollisions page contract', () => {
  const row = (id: string, providerId: string, accountId: string) => ({
    id,
    providerId,
    accountId,
    userId: `user-${id}`,
  })
  const scan = (pages: Array<{ page: unknown[]; isDone: boolean; continueCursor: string }>) => {
    const calls: Record<string, unknown>[] = []
    const ctx = {
      runQuery: async (_reference: unknown, args: Record<string, unknown>) => {
        calls.push(args)
        const next = pages.shift()
        if (!next) throw new Error('unexpected extra page')
        return next
      },
    }
    return {
      calls,
      run: (pageSize?: number) =>
        findAccountKeyCollisions(ctx as never, { adapter: { findMany: 'findMany' } } as never, {
          pageSize,
        }),
      scanWith: (options: Parameters<typeof findAccountKeyCollisions>[2]) =>
        findAccountKeyCollisions(
          ctx as never,
          { adapter: { findMany: 'findMany' } } as never,
          options,
        ),
    }
  }

  it('walks the (providerId, accountId) index in bounded pages', async () => {
    const { calls, run } = scan([
      {
        page: [row('a', 'github', '1'), row('b', 'google', '7')],
        isDone: false,
        continueCursor: 'c1',
      },
      { page: [row('c', 'google', '7')], isDone: true, continueCursor: 'c2' },
    ])

    await expect(run(2)).resolves.toEqual({
      scannedAccounts: 3,
      collisions: [
        {
          providerId: 'google',
          accountId: '7',
          accounts: [
            { id: 'b', userId: 'user-b' },
            { id: 'c', userId: 'user-c' },
          ],
        },
      ],
      isDone: true,
      continueCursor: null,
    })
    expect(calls).toEqual([
      {
        model: 'account',
        where: [{ field: 'providerId', operator: 'gte', value: '' }],
        select: ['id', 'providerId', 'accountId', 'userId'],
        paginationOpts: { cursor: null, numItems: 2 },
      },
      expect.objectContaining({ paginationOpts: { cursor: 'c1', numItems: 2 } }),
    ])
  })

  it('stops after maxPages and resumes without splitting a collision across calls', async () => {
    const { calls, scanWith } = scan([
      {
        page: [row('a', 'github', '1'), row('b', 'google', '7')],
        isDone: false,
        continueCursor: 'c1',
      },
      {
        page: [row('c', 'google', '7'), row('d', 'google', '7')],
        isDone: false,
        continueCursor: 'c2',
      },
      { page: [row('e', 'google', '8')], isDone: true, continueCursor: 'c3' },
    ])

    const first = await scanWith({ pageSize: 2, maxPages: 1 })
    expect(first).toMatchObject({ scannedAccounts: 2, collisions: [], isDone: false })
    expect(first.continueCursor).toEqual(expect.any(String))
    expect(calls).toHaveLength(1)

    const second = await scanWith({ pageSize: 2, maxPages: 1, cursor: first.continueCursor })
    // The google/7 group is still open at the page boundary: nothing partial is reported.
    expect(second).toMatchObject({ scannedAccounts: 2, collisions: [], isDone: false })
    expect(calls[1]).toMatchObject({ paginationOpts: { cursor: 'c1', numItems: 2 } })

    const third = await scanWith({ pageSize: 2, maxPages: 1, cursor: second.continueCursor })
    expect(third).toEqual({
      scannedAccounts: 1,
      collisions: [
        {
          providerId: 'google',
          accountId: '7',
          accounts: [
            { id: 'b', userId: 'user-b' },
            { id: 'c', userId: 'user-c' },
            { id: 'd', userId: 'user-d' },
          ],
        },
      ],
      isDone: true,
      continueCursor: null,
    })
    expect(calls[2]).toMatchObject({ paginationOpts: { cursor: 'c2', numItems: 2 } })
  })

  it('bounds one call to 100 pages by default', async () => {
    const pages = Array.from({ length: 101 }, (_, index) => ({
      page: [row(`r${index}`, 'github', String(index).padStart(3, '0'))],
      isDone: false,
      continueCursor: `c${index}`,
    }))
    const { calls, run } = scan(pages)

    await expect(run(1)).resolves.toMatchObject({ scannedAccounts: 100, isDone: false })
    expect(calls).toHaveLength(100)
  })

  it('rejects an invalid page budget or a forged cursor', async () => {
    const { scanWith, calls } = scan([])
    for (const maxPages of [0, 1001, 2.5]) {
      await expect(scanWith({ maxPages })).rejects.toThrow('AUTH_ACCOUNT_SCAN_MAX_PAGES_INVALID')
    }
    for (const cursor of [
      'not json',
      JSON.stringify({ cursor: 1, run: [] }),
      JSON.stringify({ cursor: 'c', run: [{ id: 'a' }] }),
      JSON.stringify({ cursor: 'c', run: [row('a', 'google', '1'), row('b', 'google', '2')] }),
    ]) {
      await expect(scanWith({ cursor })).rejects.toThrow('AUTH_ACCOUNT_SCAN_CURSOR_INVALID')
    }
    expect(calls).toHaveLength(0)
  })

  it('refuses to report when rows do not arrive in key order', async () => {
    const { run } = scan([
      {
        page: [row('a', 'google', '7'), row('b', 'github', '1'), row('c', 'google', '7')],
        isDone: true,
        continueCursor: 'c1',
      },
    ])
    await expect(run()).rejects.toThrow('AUTH_ACCOUNT_SCAN_ORDER_INVALID')
  })

  it('stops on a stalled cursor or a malformed row', async () => {
    await expect(
      scan([
        { page: [], isDone: false, continueCursor: 'same' },
        { page: [], isDone: false, continueCursor: 'same' },
      ]).run(),
    ).rejects.toThrow('AUTH_ACCOUNT_SCAN_STALLED')
    await expect(
      scan([{ page: [{ id: 'a', providerId: 'google' }], isDone: true, continueCursor: '' }]).run(),
    ).rejects.toThrow('AUTH_ACCOUNT_SCAN_ROW_INVALID')
  })
})
