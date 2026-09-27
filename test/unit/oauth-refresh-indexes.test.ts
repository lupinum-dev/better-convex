import type { GenericDataModel, GenericMutationCtx } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import schemaMetadata from '../../src/runtime/convex-auth/component/schemaMetadata'
import {
  admitOAuthRefresh,
  revokeOAuthRefreshConsent,
} from '../../src/runtime/convex-auth/oauth-refresh'

type Row = Record<string, unknown>

interface IndexRead {
  table: string
  index: string
  bounds: string[]
}

const now = 1_700_000_000_000
const resource = 'https://deployment.example.test/mcp'
const scopes = ['mcp:read', 'offline_access']

const rows: Record<string, Row[]> = {
  session: [
    {
      id: 'session',
      userId: 'user',
      expiresAt: now + 60_000,
      bcnAssuranceGeneration: 0,
    },
  ],
  user: [{ id: 'user', bcnSecurityGeneration: 0 }],
  oauthClient: [{ id: 'client-row', clientId: 'client', disabled: false, scopes }],
  oauthResource: [
    { id: 'resource-row', identifier: resource, disabled: false, allowedScopes: scopes },
  ],
  oauthClientResource: [{ id: 'link', clientId: 'client', resourceId: resource }],
  oauthConsent: [
    {
      _id: 'consent-doc',
      id: 'consent',
      clientId: 'client',
      userId: 'user',
      resources: [resource],
      scopes,
    },
  ],
}

/** A read-only fake that admits only exact index ranges declared by the component schema. */
function indexedDb() {
  const reads: IndexRead[] = []
  const deleted: string[] = []
  const db = {
    query(table: string) {
      return {
        withIndex(index: string, range: (query: unknown) => unknown) {
          const bounds: Array<[string, unknown]> = []
          const builder = {
            eq(field: string, value: unknown) {
              bounds.push([field, value])
              return builder
            },
          }
          range(builder)
          reads.push({ table, index, bounds: bounds.map(([field]) => field) })
          const matches = (rows[table] ?? []).filter((row) =>
            bounds.every(([field, value]) => row[field] === value),
          )
          return {
            filter() {
              throw new Error(`UNINDEXED_FILTER:${table}.${index}`)
            },
            async unique() {
              if (matches.length > 1) throw new Error(`NOT_UNIQUE:${table}.${index}`)
              return matches[0] ?? null
            },
          }
        },
      }
    },
    normalizeId: (_table: string, id: string) => id,
    async delete(id: string) {
      deleted.push(id)
    },
  }
  return {
    ctx: { db } as unknown as GenericMutationCtx<GenericDataModel>,
    deleted,
    reads,
  }
}

function expectExactSchemaIndexes(reads: readonly IndexRead[]): void {
  for (const read of reads) {
    const declared = schemaMetadata.models[read.table as keyof typeof schemaMetadata.models]
      ?.indexes as ReadonlyArray<{ descriptor: string; fields: readonly string[] }> | undefined
    expect(declared?.find((index) => index.descriptor === read.index)?.fields).toEqual(read.bounds)
  }
}

beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(now))
afterEach(() => vi.restoreAllMocks())

describe('OAuth refresh admission index ranges', () => {
  it('admits a grant through complete compound index ranges only', async () => {
    const { ctx, reads } = indexedDb()
    await expect(
      admitOAuthRefresh(ctx, {
        sessionId: 'session',
        userId: 'user',
        clientId: 'client',
        resources: [resource],
        scopes,
        bcnConsentId: 'consent',
      }),
    ).resolves.toEqual({ expiresAt: now + 60_000, grantId: 'consent' })

    expect(reads).toEqual(
      expect.arrayContaining([
        {
          table: 'oauthClientResource',
          index: 'clientId_resourceId',
          bounds: ['clientId', 'resourceId'],
        },
        { table: 'oauthConsent', index: 'clientId_userId', bounds: ['clientId', 'userId'] },
      ]),
    )
    expectExactSchemaIndexes(reads)
  })

  it('denies a stored 1.0.0-beta row without a consent binding before any lookup', async () => {
    const beta = {
      sessionId: 'session',
      userId: 'user',
      clientId: 'client',
      resources: [resource],
      scopes,
    }
    for (const row of [beta, { ...beta, bcnConsentId: null }]) {
      const { ctx, reads } = indexedDb()
      await expect(admitOAuthRefresh(ctx, row)).resolves.toBeNull()
      expect(reads).toEqual([])
    }

    // A row being created is bound by the adapter, so the same shape still reaches admission.
    const { ctx, reads } = indexedDb()
    await expect(admitOAuthRefresh(ctx, beta, true)).resolves.toEqual({
      expiresAt: now + 60_000,
      grantId: 'consent',
    })
    expect(reads.map(({ table }) => table)).toContain('session')
  })

  it('revokes the bound consent through the (client, user) index range', async () => {
    const { ctx, deleted, reads } = indexedDb()
    await revokeOAuthRefreshConsent(ctx, [
      { clientId: 'client', userId: 'user', bcnConsentId: 'consent' },
    ])

    expect(reads).toEqual([
      { table: 'oauthConsent', index: 'clientId_userId', bounds: ['clientId', 'userId'] },
    ])
    expectExactSchemaIndexes(reads)
    expect(deleted).toEqual(['consent-doc'])
  })

  it('keeps refresh-family invalidation on a declared (client, user) index', () => {
    expect(schemaMetadata.models.oauthRefreshToken.indexes).toContainEqual({
      descriptor: 'clientId_userId',
      fields: ['clientId', 'userId'],
    })
  })
})
