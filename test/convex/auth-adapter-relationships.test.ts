/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, makeFunctionReference } from 'convex/server'
import { describe, expect, it } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import relationshipSchema from '../fixtures/auth-relationships-component/convex/schema'
import rootSchema from '../fixtures/auth-relationships-root/convex/schema'

const rootModules = import.meta.glob('../fixtures/auth-relationships-root/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const relationshipModules = import.meta.glob(
  '../fixtures/auth-relationships-component/convex/**/*.ts',
)
const components = componentsGeneric() as unknown as {
  relationshipAuth: ComponentApi<'relationshipAuth'>
  relationshipPolicies: ComponentApi<'relationshipPolicies'>
}
const auth = components.relationshipAuth.adapter
const policies = components.relationshipPolicies.adapter
const deleteWithTriggers = makeFunctionReference<
  'mutation',
  { id: string; model: string },
  Record<string, unknown> | null
>('relationshipHarness:deleteWithTriggers')
const deleteWithParentTriggerOnly = makeFunctionReference<
  'mutation',
  { id: string; model: string },
  {
    metrics: Record<
      'bytesRead' | 'bytesWritten' | 'databaseQueries' | 'documentsRead' | 'documentsWritten',
      { remaining: number; used: number }
    >
    result: Record<string, unknown> | null
  }
>('relationshipHarness:deleteWithParentTriggerOnly')
const listEvents = makeFunctionReference<
  'query',
  Record<string, never>,
  Array<{ event: 'delete' | 'update'; model: string; rowId: string }>
>('relationshipHarness:listEvents')
const now = 1_700_000_000_000

function initRelationshipTest() {
  const test = convexTest(rootSchema, rootModules)
  test.registerComponent('relationshipAuth', authSchema, authModules)
  test.registerComponent('relationshipPolicies', relationshipSchema, relationshipModules)
  return test
}

async function createRow(
  test: ReturnType<typeof initRelationshipTest>,
  model: string,
  data: Record<string, unknown>,
) {
  return test.mutation(auth.create, { model, data })
}

async function findRow(test: ReturnType<typeof initRelationshipTest>, model: string, id: string) {
  return test.query(auth.findOne, { model, where: [{ field: 'id', value: id }] })
}

async function createUser(test: ReturnType<typeof initRelationshipTest>, id: string) {
  return createRow(test, 'user', {
    id,
    name: id,
    email: `${id}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
}

describe('Better Auth relationship enforcement', () => {
  it('rejects missing parents on create and reference-changing update', async () => {
    const test = initRelationshipTest()

    await expect(
      createRow(test, 'session', {
        id: 'orphan_session',
        expiresAt: now + 60_000,
        token: 'orphan-token',
        createdAt: now,
        updatedAt: now,
        userId: 'missing_user',
      }),
    ).rejects.toThrow('AUTH_REFERENCE_TARGET_MISSING:session.userId')

    await createUser(test, 'user_one')
    await createRow(test, 'account', {
      id: 'account_one',
      issuer: 'https://issuer.example.test',
      providerAccountId: 'subject_one',
      providerId: 'provider_one',
      userId: 'user_one',
      createdAt: now,
      updatedAt: now,
    })
    await expect(
      test.mutation(auth.updateOne, {
        model: 'account',
        where: [{ field: 'id', value: 'account_one' }],
        update: { userId: 'missing_user' },
      }),
    ).rejects.toThrow('AUTH_REFERENCE_TARGET_MISSING:account.userId')
    await expect(findRow(test, 'account', 'account_one')).resolves.toMatchObject({
      userId: 'user_one',
    })
  })

  it('cascades user authority rows atomically and permits delete then recreate', async () => {
    const test = initRelationshipTest()
    await createUser(test, 'user_cascade')
    await createRow(test, 'session', {
      id: 'session_cascade',
      expiresAt: now + 60_000,
      token: 'session-token',
      createdAt: now,
      updatedAt: now,
      userId: 'user_cascade',
    })
    await createRow(test, 'account', {
      id: 'account_cascade',
      issuer: 'https://issuer.example.test',
      providerAccountId: 'subject_cascade',
      providerId: 'provider',
      userId: 'user_cascade',
      createdAt: now,
      updatedAt: now,
    })

    await test.mutation(auth.deleteOne, {
      model: 'user',
      where: [{ field: 'id', value: 'user_cascade' }],
    })

    await expect(findRow(test, 'session', 'session_cascade')).resolves.toBeNull()
    await expect(findRow(test, 'account', 'account_cascade')).resolves.toBeNull()
    await createUser(test, 'user_cascade')
    await expect(findRow(test, 'user', 'user_cascade')).resolves.toMatchObject({
      id: 'user_cascade',
    })
  })

  it('sets nullable session references to null without deleting delegated tokens', async () => {
    const test = initRelationshipTest()
    await createUser(test, 'oauth_user')
    await createRow(test, 'session', {
      id: 'oauth_session',
      expiresAt: now + 60_000,
      token: 'oauth-session-token',
      createdAt: now,
      updatedAt: now,
      userId: 'oauth_user',
    })
    await createRow(test, 'oauthClient', {
      id: 'oauth_client_row',
      clientId: 'oauth_client',
      userId: 'oauth_user',
      redirectUris: ['https://client.example.test/callback'],
    })
    await createRow(test, 'oauthRefreshToken', {
      id: 'refresh_row',
      token: 'refresh-token',
      clientId: 'oauth_client',
      sessionId: 'oauth_session',
      userId: 'oauth_user',
      scopes: ['notes.read'],
    })

    await test.mutation(auth.deleteOne, {
      model: 'session',
      where: [{ field: 'id', value: 'oauth_session' }],
    })

    await expect(findRow(test, 'oauthRefreshToken', 'refresh_row')).resolves.toMatchObject({
      id: 'refresh_row',
      sessionId: null,
    })
  })

  it('rejects restricted deletion without partially applying other relationship effects', async () => {
    const test = initRelationshipTest()
    await test.mutation(policies.create, {
      model: 'parent',
      data: { id: 'parent_restricted' },
    })
    await test.mutation(policies.create, {
      model: 'cascadeChild',
      data: { id: 'cascade_sibling', parentId: 'parent_restricted' },
    })
    await test.mutation(policies.create, {
      model: 'nullableChild',
      data: { id: 'nullable_sibling', parentId: 'parent_restricted' },
    })
    await test.mutation(policies.create, {
      model: 'restrictChild',
      data: { id: 'restrict_child', parentId: 'parent_restricted' },
    })

    await expect(
      test.mutation(policies.deleteOne, {
        model: 'parent',
        where: [{ field: 'id', value: 'parent_restricted' }],
      }),
    ).rejects.toThrow('AUTH_REFERENCE_DELETE_RESTRICTED:parent.id')

    await expect(
      test.query(policies.findOne, {
        model: 'parent',
        where: [{ field: 'id', value: 'parent_restricted' }],
      }),
    ).resolves.toMatchObject({ id: 'parent_restricted' })
    await expect(
      test.query(policies.findOne, {
        model: 'cascadeChild',
        where: [{ field: 'id', value: 'cascade_sibling' }],
      }),
    ).resolves.toMatchObject({ id: 'cascade_sibling' })
    await expect(
      test.query(policies.findOne, {
        model: 'nullableChild',
        where: [{ field: 'id', value: 'nullable_sibling' }],
      }),
    ).resolves.toMatchObject({
      id: 'nullable_sibling',
      parentId: 'parent_restricted',
    })
  })

  it('applies cascade and set-null policies in one successful deletion', async () => {
    const test = initRelationshipTest()
    await test.mutation(policies.create, {
      model: 'parent',
      data: { id: 'parent_mixed' },
    })
    await test.mutation(policies.create, {
      model: 'cascadeChild',
      data: { id: 'cascade_child', parentId: 'parent_mixed' },
    })
    await test.mutation(policies.create, {
      model: 'nullableChild',
      data: { id: 'nullable_child', parentId: 'parent_mixed' },
    })

    await test.mutation(deleteWithTriggers, { id: 'parent_mixed', model: 'parent' })

    await expect(
      test.query(policies.findOne, {
        model: 'cascadeChild',
        where: [{ field: 'id', value: 'cascade_child' }],
      }),
    ).resolves.toBeNull()
    await expect(
      test.query(policies.findOne, {
        model: 'nullableChild',
        where: [{ field: 'id', value: 'nullable_child' }],
      }),
    ).resolves.toMatchObject({ id: 'nullable_child', parentId: null })
    const events = await test.query(listEvents, {})
    expect(events.map(({ event, model, rowId }) => ({ event, model, rowId }))).toEqual([
      { event: 'update', model: 'nullableChild', rowId: 'nullable_child' },
      { event: 'delete', model: 'cascadeChild', rowId: 'cascade_child' },
      { event: 'delete', model: 'parent', rowId: 'parent_mixed' },
    ])
  })

  it('deletes cyclic cascade closures exactly once', async () => {
    const test = initRelationshipTest()
    await test.mutation(policies.create, {
      model: 'node',
      data: { id: 'node_a', parentId: null },
    })
    await test.mutation(policies.create, {
      model: 'node',
      data: { id: 'node_b', parentId: 'node_a' },
    })
    await test.mutation(policies.updateOne, {
      model: 'node',
      where: [{ field: 'id', value: 'node_a' }],
      update: { parentId: 'node_b' },
    })

    await test.mutation(policies.deleteOne, {
      model: 'node',
      where: [{ field: 'id', value: 'node_a' }],
    })

    await expect(
      test.query(policies.findOne, {
        model: 'node',
        where: [{ field: 'id', value: 'node_a' }],
      }),
    ).resolves.toBeNull()
    await expect(
      test.query(policies.findOne, {
        model: 'node',
        where: [{ field: 'id', value: 'node_b' }],
      }),
    ).resolves.toBeNull()
  })

  it('rejects an oversized cascade plan before deleting any row', async () => {
    const test = initRelationshipTest()
    await test.mutation(policies.create, {
      model: 'parent',
      data: { id: 'parent_oversized' },
    })
    for (let index = 0; index < 128; index += 1) {
      await test.mutation(policies.create, {
        model: 'cascadeChild',
        data: { id: `oversized_child_${index}`, parentId: 'parent_oversized' },
      })
    }

    await expect(
      test.mutation(deleteWithTriggers, {
        id: 'parent_oversized',
        model: 'parent',
      }),
    ).rejects.toThrow('AUTH_BULK_OPERATION_LIMIT_EXCEEDED')
    await expect(
      test.query(policies.findOne, {
        model: 'parent',
        where: [{ field: 'id', value: 'parent_oversized' }],
      }),
    ).resolves.toMatchObject({ id: 'parent_oversized' })
    await expect(
      test.query(policies.count, {
        model: 'cascadeChild',
        where: [{ field: 'parentId', value: 'parent_oversized' }],
      }),
    ).resolves.toBe(128)
    await expect(test.query(listEvents, {})).resolves.toEqual([])
  })

  it('accepts an at-limit mixed plan and triggers only configured models', async () => {
    const test = initRelationshipTest()
    await test.mutation(policies.create, {
      model: 'parent',
      data: { id: 'parent_at_limit' },
    })
    for (let index = 0; index < 126; index += 1) {
      await test.mutation(policies.create, {
        model: 'cascadeChild',
        data: { id: `at_limit_child_${index}`, parentId: 'parent_at_limit' },
      })
    }
    await test.mutation(policies.create, {
      model: 'nullableChild',
      data: { id: 'at_limit_nullable', parentId: 'parent_at_limit' },
    })

    const { metrics } = await test.mutation(deleteWithParentTriggerOnly, {
      id: 'parent_at_limit',
      model: 'parent',
    })

    await expect(
      test.query(policies.count, {
        model: 'cascadeChild',
        where: [{ field: 'parentId', value: 'parent_at_limit' }],
      }),
    ).resolves.toBe(0)
    await expect(
      test.query(policies.findOne, {
        model: 'nullableChild',
        where: [{ field: 'id', value: 'at_limit_nullable' }],
      }),
    ).resolves.toMatchObject({ parentId: null })
    const events = await test.query(listEvents, {})
    expect(events.map(({ event, model, rowId }) => ({ event, model, rowId }))).toEqual([
      { event: 'delete', model: 'parent', rowId: 'parent_at_limit' },
    ])
    for (const metric of Object.values(metrics)) {
      expect(metric.remaining).toBeGreaterThan(metric.used * 10)
    }
  })

  it('rolls back the complete plan when a late configured trigger fails', async () => {
    const test = initRelationshipTest()
    await test.mutation(policies.create, {
      model: 'parent',
      data: { id: 'parent_trigger_failure' },
    })
    await test.mutation(policies.create, {
      model: 'cascadeChild',
      data: { id: 'rollback_child', parentId: 'parent_trigger_failure' },
    })

    await expect(
      test.mutation(deleteWithParentTriggerOnly, {
        id: 'parent_trigger_failure',
        model: 'parent',
      }),
    ).rejects.toThrow('EXPECTED_TRIGGER_FAILURE')
    await expect(
      test.query(policies.findOne, {
        model: 'parent',
        where: [{ field: 'id', value: 'parent_trigger_failure' }],
      }),
    ).resolves.toMatchObject({ id: 'parent_trigger_failure' })
    await expect(
      test.query(policies.findOne, {
        model: 'cascadeChild',
        where: [{ field: 'id', value: 'rollback_child' }],
      }),
    ).resolves.toMatchObject({ id: 'rollback_child' })
    await expect(test.query(listEvents, {})).resolves.toEqual([])
  })
})
