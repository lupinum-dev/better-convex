/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import {
  validateOAuthAccess as checkOAuthAccess,
  type OAuthLiveAccess,
} from '../../src/runtime/convex-auth/oauth-live-access'
import rootSchema from '../fixtures/auth-relationships-root/convex/schema'

const rootModules = import.meta.glob('../fixtures/auth-relationships-root/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const components = componentsGeneric() as unknown as {
  relationshipAuth: ComponentApi<'relationshipAuth'>
}
const auth = components.relationshipAuth.adapter

const now = 1_700_000_000_000
const access = Object.freeze({
  grantId: 'oauth-consent-row',
  clientId: 'oauth-client',
  issuer: 'https://accounts.example.test/api/auth',
  resource: 'https://deployment.example.test/mcp',
  scopes: Object.freeze(['mcp:read', 'mcp:write', 'offline_access']),
  sessionId: 'oauth-session',
  subject: 'oauth-user',
}) satisfies OAuthLiveAccess

function initTest() {
  const test = convexTest(rootSchema, rootModules)
  test.registerComponent('relationshipAuth', authSchema, authModules)
  return test
}

async function createRow(
  test: ReturnType<typeof initTest>,
  model: string,
  data: Record<string, unknown>,
) {
  await test.mutation(auth.create, { data, model })
}

async function createLiveGrant(test: ReturnType<typeof initTest>): Promise<void> {
  await createRow(test, 'user', {
    createdAt: now,
    email: 'oauth-user@example.test',
    emailVerified: true,
    id: access.subject,
    name: 'OAuth user',
    updatedAt: now,
  })
  await createRow(test, 'session', {
    createdAt: now,
    expiresAt: now + 60_000,
    id: access.sessionId,
    token: 'session-token',
    updatedAt: now,
    userId: access.subject,
  })
  await createRow(test, 'oauthClient', {
    clientId: access.clientId,
    disabled: false,
    id: 'oauth-client-row',
    redirectUris: ['https://client.example.test/callback'],
    scopes: [...access.scopes],
  })
  await createRow(test, 'oauthResource', {
    allowedScopes: [...access.scopes],
    disabled: false,
    id: 'oauth-resource-row',
    identifier: access.resource,
    name: 'MCP resource',
  })
  await createRow(test, 'oauthClientResource', {
    clientId: access.clientId,
    id: 'oauth-client-resource-row',
    resourceId: access.resource,
  })
  await createRow(test, 'oauthConsent', {
    clientId: access.clientId,
    id: 'oauth-consent-row',
    resources: [access.resource],
    scopes: [...access.scopes],
    userId: access.subject,
  })
}

async function validate(test: ReturnType<typeof initTest>): Promise<boolean> {
  return await test.query((ctx) => checkOAuthAccess(ctx, components.relationshipAuth, access))
}

async function updateRow(
  test: ReturnType<typeof initTest>,
  model: string,
  id: string,
  update: Record<string, unknown>,
): Promise<void> {
  await test.mutation(auth.updateOne, {
    model,
    update,
    where: [{ field: 'id', value: id }],
  })
}

function refresh(id = 'refresh-1') {
  return {
    id,
    token: `hash-${id}`,
    clientId: access.clientId,
    userId: access.subject,
    sessionId: access.sessionId,
    resources: [access.resource],
    scopes: [...access.scopes],
    createdAt: now,
    expiresAt: now + 604800000,
  }
}
async function rotate(test: ReturnType<typeof initTest>, id = 'refresh-1') {
  return test.mutation(auth.incrementOne, {
    model: 'oauthRefreshToken',
    where: [
      { field: 'id', value: id },
      { field: 'revoked', value: null },
    ],
    increment: {},
    set: { revoked: now, rotatedAt: now, rotationReplayExpiresAt: now + 10000 },
  })
}
async function invalidate(test: ReturnType<typeof initTest>) {
  return test.mutation(auth.deleteMany, {
    model: 'oauthRefreshToken',
    where: [
      { field: 'clientId', value: access.clientId },
      { field: 'userId', value: access.subject },
    ],
  })
}

describe('canonical OAuth refresh protection', () => {
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(now))
  afterEach(() => vi.restoreAllMocks())

  it('caps refresh lifetime to the original session without extending it', async () => {
    const test = initTest()
    await createLiveGrant(test)
    await createRow(test, 'oauthRefreshToken', refresh())
    const row = await test.query(auth.findOne, {
      model: 'oauthRefreshToken',
      where: [{ field: 'id', value: 'refresh-1' }],
    })
    expect(row?.expiresAt).toBe(now + 60000)
    await rotate(test)
    await updateRow(test, 'session', access.sessionId, {
      expiresAt: now + 604800000,
    })
    await test.mutation(auth.create, {
      model: 'oauthRefreshToken',
      data: refresh('refresh-2'),
      oauthRefreshParentId: 'refresh-1',
    })
    const next = await test.query(auth.findOne, {
      model: 'oauthRefreshToken',
      where: [{ field: 'id', value: 'refresh-2' }],
    })
    expect(next?.expiresAt).toBe(now + 60000)
  })

  it('admits one concurrent rotation and rejects the other', async () => {
    const test = initTest()
    await createLiveGrant(test)
    await createRow(test, 'oauthRefreshToken', refresh())
    const results = await Promise.all([rotate(test), rotate(test)])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it.each(['delete-before-create', 'create-before-delete'] as const)(
    'cannot resurrect a family during %s',
    async (order) => {
      const test = initTest()
      await createLiveGrant(test)
      await createRow(test, 'oauthRefreshToken', refresh())
      await rotate(test)
      const create = () =>
        test.mutation(auth.create, {
          model: 'oauthRefreshToken',
          data: refresh('refresh-2'),
          oauthRefreshParentId: 'refresh-1',
        })
      if (order === 'delete-before-create') {
        await invalidate(test)
        await expect(create()).rejects.toThrow('AUTH_OAUTH_REFRESH_INVALID')
      } else {
        await create()
        await invalidate(test)
      }
      expect(await test.query(auth.count, { model: 'oauthRefreshToken' })).toBe(0)
      expect(await validate(test)).toBe(false)
    },
  )

  it('does not resurrect an old rotation after the user consents again', async () => {
    const test = initTest()
    await createLiveGrant(test)
    await createRow(test, 'oauthRefreshToken', refresh())
    await rotate(test)
    await invalidate(test)
    await createRow(test, 'oauthConsent', {
      id: 'new-consent',
      clientId: access.clientId,
      userId: access.subject,
      resources: [access.resource],
      scopes: [...access.scopes],
    })
    await expect(
      test.mutation(auth.create, {
        model: 'oauthRefreshToken',
        data: refresh('refresh-2'),
        oauthRefreshParentId: 'refresh-1',
      }),
    ).rejects.toThrow('AUTH_OAUTH_REFRESH_INVALID')
  })

  it.each([
    ['session', 'session', access.sessionId, { expiresAt: now }],
    ['client', 'oauthClient', 'oauth-client-row', { disabled: true }],
    ['consent', 'oauthConsent', 'oauth-consent-row', { scopes: ['mcp:read'] }],
    ['resource', 'oauthResource', 'oauth-resource-row', { disabled: true }],
  ])('rejects refresh reads and writes after revoked %s', async (_label, model, id, update) => {
    const test = initTest()
    await createLiveGrant(test)
    await createRow(test, 'oauthRefreshToken', refresh())
    await updateRow(test, model as string, id as string, update as Record<string, unknown>)
    expect(
      await test.query(auth.findOne, {
        model: 'oauthRefreshToken',
        where: [{ field: 'id', value: 'refresh-1' }],
      }),
    ).toBeNull()
    await expect(createRow(test, 'oauthRefreshToken', refresh('refresh-2'))).rejects.toThrow(
      'AUTH_OAUTH_REFRESH_INVALID',
    )
  })

  it('revokes current consent with an explicit refresh-token revocation', async () => {
    const test = initTest()
    await createLiveGrant(test)
    await createRow(test, 'oauthRefreshToken', refresh())
    await test.mutation(auth.incrementOne, {
      model: 'oauthRefreshToken',
      where: [
        { field: 'id', value: 'refresh-1' },
        { field: 'revoked', value: null },
      ],
      increment: {},
      set: { revoked: now },
    })
    expect(await validate(test)).toBe(false)
  })

  it('rejects a successor with changed client, scope, resource, or unrotated parent', async () => {
    const test = initTest()
    await createLiveGrant(test)
    await createRow(test, 'oauthRefreshToken', refresh())
    await expect(
      test.mutation(auth.create, {
        model: 'oauthRefreshToken',
        data: refresh('refresh-2'),
        oauthRefreshParentId: 'refresh-1',
      }),
    ).rejects.toThrow('AUTH_OAUTH_REFRESH_INVALID')
    await rotate(test)
    for (const patch of [
      { clientId: 'other-client' },
      { scopes: ['offline_access', 'admin'] },
      { resources: ['https://other.example/mcp'] },
    ]) {
      await expect(
        test.mutation(auth.create, {
          model: 'oauthRefreshToken',
          data: { ...refresh('refresh-2'), ...patch },
          oauthRefreshParentId: 'refresh-1',
        }),
      ).rejects.toThrow('AUTH_OAUTH_REFRESH_INVALID')
    }
  })
  it('revokes a large family even when physical cleanup exceeds the bulk limit', async () => {
    const test = initTest()
    await createLiveGrant(test)
    for (let index = 0; index < 130; index++)
      await createRow(test, 'oauthRefreshToken', refresh(`refresh-${index}`))
    expect(await invalidate(test)).toBe(128)
    expect(await validate(test)).toBe(false)
    const retained = await test.query(auth.findMany, {
      model: 'oauthRefreshToken',
      paginationOpts: { cursor: null, numItems: 10 },
    })
    expect(retained.page).toHaveLength(2)
    for (const row of retained.page) {
      expect(
        await test.query(auth.findOne, {
          model: 'oauthRefreshToken',
          where: [{ field: 'id', value: String(row.id) }],
        }),
      ).toBeNull()
    }
    await createRow(test, 'oauthConsent', {
      id: 'new-consent',
      clientId: access.clientId,
      userId: access.subject,
      resources: [access.resource],
      scopes: [...access.scopes],
    })
    for (const row of retained.page)
      expect(
        await test.query(auth.findOne, {
          model: 'oauthRefreshToken',
          where: [{ field: 'id', value: String(row.id) }],
        }),
      ).toBeNull()
  })
  it.each([
    ['session', access.sessionId],
    ['user', access.subject],
    ['oauthClient', 'oauth-client-row'],
  ])(
    'removes %s authority when renewal history exceeds the relationship limit',
    async (model, id) => {
      const test = initTest()
      await createLiveGrant(test)
      const parent = await test.query(auth.findOne, {
        model,
        where: [{ field: 'id', value: id }],
      })
      expect(parent).not.toBeNull()
      for (let index = 0; index < 128; index++)
        await createRow(test, 'oauthRefreshToken', refresh(`refresh-${index}`))
      await test.mutation(auth.deleteOne, {
        model,
        where: [{ field: 'id', value: id }],
      })
      expect(await validate(test)).toBe(false)
      expect(await rotate(test, 'refresh-127')).toBeNull()
      await expect(
        createRow(test, 'oauthRefreshToken', refresh('after-revocation')),
      ).rejects.toThrow('AUTH_OAUTH_REFRESH_INVALID')
      await test.mutation(auth.deleteOne, {
        model: 'oauthConsent',
        where: [{ field: 'id', value: 'oauth-consent-row' }],
      })
      await createRow(test, model, parent!)
      if (model === 'user') {
        await createRow(test, 'session', {
          id: access.sessionId,
          userId: access.subject,
          token: 'replacement-session-token',
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 60_000,
        })
      }
      if (model === 'oauthClient') {
        await createRow(test, 'oauthClientResource', {
          id: 'replacement-client-resource',
          clientId: access.clientId,
          resourceId: access.resource,
        })
      }
      await createRow(test, 'oauthConsent', {
        id: 'replacement-consent',
        clientId: access.clientId,
        userId: access.subject,
        scopes: [...access.scopes],
        resources: [access.resource],
      })
      expect(await validate(test)).toBe(false)
      expect(await rotate(test, 'refresh-127')).toBeNull()
      expect(
        await test.query(auth.findOne, {
          model: 'oauthRefreshToken',
          where: [{ field: 'id', value: 'refresh-127' }],
        }),
      ).toBeNull()
    },
  )
  it('does not let a stale in-flight family revoke replacement consent', async () => {
    const test = initTest()
    await createLiveGrant(test)
    await createRow(test, 'oauthRefreshToken', refresh())
    await test.mutation(auth.deleteOne, {
      model: 'oauthConsent',
      where: [{ field: 'id', value: 'oauth-consent-row' }],
    })
    await createRow(test, 'oauthConsent', {
      id: 'new-consent',
      clientId: access.clientId,
      userId: access.subject,
      resources: [access.resource],
      scopes: [...access.scopes],
    })
    await createRow(test, 'oauthRefreshToken', refresh('new-grant-refresh'))
    await test.mutation(auth.deleteMany, {
      model: 'oauthRefreshToken',
      where: [
        { field: 'clientId', value: access.clientId },
        { field: 'userId', value: access.subject },
      ],
      oauthRefreshGrantId: 'oauth-consent-row',
    })
    expect(
      await test.query(auth.findOne, {
        model: 'oauthConsent',
        where: [{ field: 'id', value: 'new-consent' }],
      }),
    ).not.toBeNull()
    expect(
      await test.query(auth.findOne, {
        model: 'oauthRefreshToken',
        where: [{ field: 'id', value: 'new-grant-refresh' }],
      }),
    ).not.toBeNull()
  })
  it('revokes a large authorization-code family when its original code is replayed', async () => {
    const test = initTest()
    await createLiveGrant(test)
    for (let index = 0; index < 130; index++)
      await createRow(test, 'oauthRefreshToken', {
        ...refresh(`refresh-${index}`),
        authorizationCodeId: 'original-code-hash',
      })
    expect(
      await test.mutation(auth.deleteMany, {
        model: 'oauthRefreshToken',
        where: [{ field: 'authorizationCodeId', value: 'original-code-hash' }],
      }),
    ).toBe(128)
    expect(await validate(test)).toBe(false)
    const retained = await test.query(auth.findMany, {
      model: 'oauthRefreshToken',
      paginationOpts: { cursor: null, numItems: 10 },
    })
    expect(retained.page).toHaveLength(2)
    for (const row of retained.page)
      expect(
        await test.query(auth.findOne, {
          model: 'oauthRefreshToken',
          where: [{ field: 'id', value: String(row.id) }],
        }),
      ).toBeNull()
  })
})
