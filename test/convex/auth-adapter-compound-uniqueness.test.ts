/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema } from 'convex/server'
import { describe, expect, it } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import teamAuthSchema from '../../starters/team/convex/betterAuth/schema'

const rootModules = import.meta.glob('../fixtures/jwks-rotation/convex/**/*.ts')
const authModules = import.meta.glob('../../starters/team/convex/betterAuth/**/*.ts')
const rootSchema = defineSchema({})
const components = componentsGeneric() as unknown as {
  compoundUniqueAuth: ComponentApi<'compoundUniqueAuth'>
}
const auth = components.compoundUniqueAuth.adapter
const now = 1_700_000_000_000

function initCompoundUniqueTest() {
  const test = convexTest(rootSchema, rootModules)
  test.registerComponent('compoundUniqueAuth', teamAuthSchema, authModules)
  return test
}

async function createAuthRow(
  test: ReturnType<typeof initCompoundUniqueTest>,
  model: string,
  data: Record<string, unknown>,
) {
  return await test.mutation(auth.create, { model, data })
}

async function createUser(test: ReturnType<typeof initCompoundUniqueTest>, id: string) {
  await createAuthRow(test, 'user', {
    id,
    name: id,
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
}

async function createOrganization(test: ReturnType<typeof initCompoundUniqueTest>, id: string) {
  await createAuthRow(test, 'organization', {
    id,
    name: id,
    slug: id,
    createdAt: now,
  })
}

async function createTeam(
  test: ReturnType<typeof initCompoundUniqueTest>,
  id: string,
  organizationId: string,
) {
  await createAuthRow(test, 'team', {
    id,
    name: id,
    memberCount: 0,
    organizationId,
    createdAt: now,
  })
}

function account(id: string, accountId: string, providerId: string, userId: string) {
  return { id, accountId, providerId, userId, createdAt: now, updatedAt: now }
}

function member(id: string, organizationId: string, userId: string, role: string) {
  return { id, organizationId, userId, role, createdAt: now }
}

describe('Better Auth adapter compound uniqueness', () => {
  it('rejects duplicate account, organization-member, and team-member identities', async () => {
    const test = initCompoundUniqueTest()
    await createUser(test, 'user_one')
    await createUser(test, 'user_two')
    await createOrganization(test, 'organization_one')
    await createTeam(test, 'team_one', 'organization_one')

    await createAuthRow(
      test,
      'account',
      account('account_one', 'subject_one', 'provider_one', 'user_one'),
    )
    await createAuthRow(
      test,
      'account',
      account('account_same_provider_user', 'subject_two', 'provider_one', 'user_one'),
    )
    await createAuthRow(
      test,
      'account',
      account('account_same_subject_other_provider', 'subject_one', 'provider_two', 'user_two'),
    )
    await expect(
      createAuthRow(
        test,
        'account',
        account('account_two', 'subject_one', 'provider_one', 'user_two'),
      ),
    ).rejects.toThrow('AUTH_UNIQUE_CONFLICT:account.providerId_accountId')
    await expect(
      test.mutation(auth.updateOne, {
        model: 'account',
        where: [{ field: 'id', value: 'account_same_subject_other_provider' }],
        update: { providerId: 'provider_one' },
      }),
    ).rejects.toThrow('AUTH_UNIQUE_CONFLICT:account.providerId_accountId')

    await createAuthRow(
      test,
      'member',
      member('member_one', 'organization_one', 'user_one', 'owner'),
    )
    await expect(
      createAuthRow(test, 'member', member('member_two', 'organization_one', 'user_one', 'member')),
    ).rejects.toThrow('AUTH_UNIQUE_CONFLICT:member.organizationId_userId')

    await createAuthRow(test, 'teamMember', {
      id: 'team_member_one',
      teamId: 'team_one',
      userId: 'user_one',
    })
    await expect(
      createAuthRow(test, 'teamMember', {
        id: 'team_member_two',
        teamId: 'team_one',
        userId: 'user_one',
      }),
    ).rejects.toThrow('AUTH_UNIQUE_CONFLICT:teamMember.teamId_userId')
  })

  it('allows multiple null values for nullable unique fields', async () => {
    const test = initCompoundUniqueTest()
    await createUser(test, 'user_one')
    await createUser(test, 'user_two')
    await createOrganization(test, 'organization_one')
    await createOrganization(test, 'organization_two')
    await createTeam(test, 'team_one', 'organization_one')
    await createTeam(test, 'team_two', 'organization_two')

    await createAuthRow(test, 'teamMember', {
      id: 'team_member_null_one',
      teamId: 'team_one',
      userId: 'user_one',
      membershipKey: null,
    })
    await createAuthRow(test, 'teamMember', {
      id: 'team_member_null_two',
      teamId: 'team_two',
      userId: 'user_two',
      membershipKey: null,
    })
  })

  it('checks merged update candidates and rolls back conflicting bulk updates', async () => {
    const test = initCompoundUniqueTest()
    await createUser(test, 'user_shared')
    await createOrganization(test, 'organization_one')
    await createOrganization(test, 'organization_two')
    await createOrganization(test, 'organization_three')

    await createAuthRow(
      test,
      'member',
      member('member_update_one', 'organization_one', 'user_shared', 'owner'),
    )
    await createAuthRow(
      test,
      'member',
      member('member_update_two', 'organization_two', 'user_shared', 'member'),
    )

    await expect(
      test.mutation(auth.updateOne, {
        model: 'member',
        where: [{ field: 'id', value: 'member_update_two' }],
        update: { organizationId: 'organization_one' },
      }),
    ).rejects.toThrow('AUTH_UNIQUE_CONFLICT:member.organizationId_userId')

    await expect(
      test.mutation(auth.incrementOne, {
        model: 'member',
        where: [{ field: 'id', value: 'member_update_two' }],
        increment: {},
        set: { organizationId: 'organization_one' },
      }),
    ).rejects.toThrow('AUTH_UNIQUE_CONFLICT:member.organizationId_userId')

    await expect(
      test.mutation(auth.updateMany, {
        model: 'member',
        where: [{ field: 'userId', value: 'user_shared' }],
        update: { organizationId: 'organization_three' },
      }),
    ).rejects.toThrow('AUTH_UNIQUE_CONFLICT:member.organizationId_userId')

    const [first, second] = await Promise.all([
      test.query(auth.findOne, {
        model: 'member',
        where: [{ field: 'id', value: 'member_update_one' }],
      }),
      test.query(auth.findOne, {
        model: 'member',
        where: [{ field: 'id', value: 'member_update_two' }],
      }),
    ])

    expect(first).toMatchObject({ organizationId: 'organization_one' })
    expect(second).toMatchObject({ organizationId: 'organization_two' })
  })
})
