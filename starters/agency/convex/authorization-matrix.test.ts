import { signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { describe, expect, it } from 'vitest'

import { api } from './_generated/api'
import { initConvexTest } from './test.setup'

describe('agency public authorization matrix', () => {
  it('creates organizations only for a projected authenticated user', async () => {
    const t = initConvexTest()

    await expect(
      t.mutation(api.organizations.create, {
        name: 'Anonymous Agency',
        kind: 'agency',
      }),
    ).rejects.toThrow('Authentication required')

    await expect(
      (await signInAs(t, 'missing-projection')).mutation(api.organizations.create, {
        name: 'Missing Projection Agency',
        kind: 'agency',
      }),
    ).rejects.toThrow('User not found')

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        subject: 'owner',
        name: 'Owner',
        email: 'owner@example.com',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    })

    const organizationId = await (
      await signInAs(t, 'owner')
    ).mutation(api.organizations.create, {
      name: '  Defensible Agency  ',
      kind: 'agency',
    })

    const rows = await t.run(async (ctx) => ({
      organization: await ctx.db.get(organizationId),
      membership: await ctx.db
        .query('memberships')
        .withIndex('by_org_user', (q) =>
          q.eq('organizationId', organizationId).eq('userId', userId),
        )
        .unique(),
      auditEvents: await ctx.db
        .query('auditEvents')
        .withIndex('by_org_created', (q) => q.eq('organizationId', organizationId))
        .collect(),
    }))

    expect(rows.organization).toMatchObject({
      name: 'Defensible Agency',
      kind: 'agency',
      createdBy: userId,
    })
    expect(rows.membership).toMatchObject({
      organizationId,
      userId,
      role: 'owner',
      status: 'active',
    })
    expect(rows.auditEvents).toEqual([
      expect.objectContaining({
        organizationId,
        actorUserId: userId,
        accessPath: 'direct',
        action: 'organizations.create',
        resourceType: 'organization',
        resourceId: organizationId,
      }),
    ])
  })

  it('denies anonymous client-list and link-revocation calls directly', async () => {
    const t = initConvexTest()
    const { agencyOrganizationId, clientOrganizationId } = await t.run(async (ctx) => {
      const now = Date.now()
      const creatorId = await ctx.db.insert('users', {
        subject: 'matrix-creator',
        createdAt: now,
        updatedAt: now,
      })
      const agencyOrganizationId = await ctx.db.insert('organizations', {
        name: 'Agency',
        kind: 'agency',
        createdBy: creatorId,
        createdAt: now,
      })
      const clientOrganizationId = await ctx.db.insert('organizations', {
        name: 'Client',
        kind: 'client',
        createdBy: creatorId,
        createdAt: now,
      })
      await ctx.db.insert('organizationLinks', {
        agencyOrganizationId,
        clientOrganizationId,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      return { agencyOrganizationId, clientOrganizationId }
    })

    await expect(
      t.query(api.organizationLinks.listClients, { agencyOrganizationId }),
    ).rejects.toThrow('Authentication required')
    await expect(
      t.mutation(api.organizationLinks.revoke, {
        agencyOrganizationId,
        clientOrganizationId,
      }),
    ).rejects.toThrow('Authentication required')

    const link = await t.run(async (ctx) => {
      return await ctx.db
        .query('organizationLinks')
        .withIndex('by_agency_client', (q) =>
          q
            .eq('agencyOrganizationId', agencyOrganizationId)
            .eq('clientOrganizationId', clientOrganizationId),
        )
        .unique()
    })
    expect(link).toMatchObject({ status: 'active' })
  })
})
