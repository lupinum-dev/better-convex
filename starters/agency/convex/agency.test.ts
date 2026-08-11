import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'

import { api, components, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { initConvexTest, modules } from './test.setup'

async function seedUser(t: ReturnType<typeof convexTest>, subject: string) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('users', {
      subject,
      name: subject,
      email: `${subject}@example.com`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  })
}

async function seedOrganization(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  kind: 'agency' | 'client',
  name: string,
) {
  return await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert('organizations', {
      name,
      kind,
      createdBy: userId,
      createdAt: Date.now(),
    })
    await ctx.db.insert('memberships', {
      organizationId,
      userId,
      role: 'owner',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    return organizationId
  })
}

async function linkClient(
  t: ReturnType<typeof convexTest>,
  agencyOrganizationId: Id<'organizations'>,
  clientOrganizationId: Id<'organizations'>,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('organizationLinks', {
      agencyOrganizationId,
      clientOrganizationId,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  })
}

describe('agency starter invariants', () => {
  it('syncs Better Auth user creates and updates into the app-owned actor row', async () => {
    const t = initConvexTest()

    await t.mutation(internal.auth.onCreate, {
      model: 'user',
      doc: { id: 'auth-user-1', name: 'Ada', email: 'ada@example.com' },
    })
    await t.mutation(internal.auth.onCreate, {
      model: 'user',
      doc: { id: 'auth-user-1', name: 'Ada', email: 'ada@example.com' },
    })
    await t.mutation(internal.auth.onUpdate, {
      model: 'user',
      oldDoc: { id: 'auth-user-1', name: 'Ada', email: 'ada@example.com' },
      newDoc: { id: 'auth-user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
    })

    const users = await t.run(async (ctx) => await ctx.db.query('users').collect())
    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({
      subject: 'auth-user-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    })
  })

  it('rebuilds a missing app user from the canonical Better Auth user page', async () => {
    const t = initConvexTest()
    const authUser = (await t.run(async (ctx) => {
      return await ctx.runMutation(components.betterAuth.adapter.create, {
        model: 'user',
        data: {
          id: 'auth-user-grace',
          name: 'Grace Hopper',
          email: 'grace@example.com',
          emailVerified: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      })
    })) as { id: string }

    const result = await t.mutation(internal.auth.rebuildUserProjectionBatch, {
      cursor: null,
    })

    expect(result).toMatchObject({ inserted: 1, patched: 0, skipped: 0, isDone: true })
    const users = await t.run(async (ctx) => await ctx.db.query('users').collect())
    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({
      subject: authUser.id,
      name: 'Grace Hopper',
      email: 'grace@example.com',
    })
  })

  it('fails closed on duplicate domain actors without deleting referenced rows', async () => {
    const t = initConvexTest()
    const authUser = (await t.run(async (ctx) => {
      return await ctx.runMutation(components.betterAuth.adapter.create, {
        model: 'user',
        data: {
          id: 'auth-user-duplicate',
          name: 'Canonical Name',
          email: 'duplicate@example.com',
          emailVerified: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      })
    })) as { id: string }

    const seeded = await t.run(async (ctx) => {
      const now = Date.now()
      const firstActorId = await ctx.db.insert('users', {
        subject: authUser.id,
        name: 'First actor',
        email: 'first@example.com',
        createdAt: now,
        updatedAt: now,
      })
      const secondActorId = await ctx.db.insert('users', {
        subject: authUser.id,
        name: 'Second actor',
        email: 'second@example.com',
        createdAt: now,
        updatedAt: now,
      })
      const agencyOrganizationId = await ctx.db.insert('organizations', {
        name: 'Agency',
        kind: 'agency',
        createdBy: firstActorId,
        createdAt: now,
      })
      const clientOrganizationId = await ctx.db.insert('organizations', {
        name: 'Client',
        kind: 'client',
        createdBy: secondActorId,
        createdAt: now,
      })
      const firstMembershipId = await ctx.db.insert('memberships', {
        organizationId: agencyOrganizationId,
        userId: firstActorId,
        role: 'owner',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      const secondMembershipId = await ctx.db.insert('memberships', {
        organizationId: clientOrganizationId,
        userId: secondActorId,
        role: 'owner',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      const projectId = await ctx.db.insert('clientProjects', {
        clientOrganizationId,
        name: 'Referenced project',
        createdBy: secondActorId,
        actingFromOrganizationId: agencyOrganizationId,
        createdAt: now,
      })
      const auditId = await ctx.db.insert('auditEvents', {
        organizationId: clientOrganizationId,
        actorUserId: firstActorId,
        accessPath: 'delegated',
        action: 'test.reference',
        resourceType: 'clientProject',
        resourceId: projectId,
        createdAt: now,
      })

      return {
        firstActorId,
        secondActorId,
        agencyOrganizationId,
        clientOrganizationId,
        firstMembershipId,
        secondMembershipId,
        projectId,
        auditId,
      }
    })

    const duplicateError = 'Duplicate Agency user actors require explicit reference reconciliation'
    await expect(
      t.mutation(internal.auth.onCreate, {
        model: 'user',
        doc: {
          id: authUser.id,
          name: 'Canonical Name',
          email: 'duplicate@example.com',
        },
      }),
    ).rejects.toThrow(duplicateError)
    await expect(
      t.mutation(internal.auth.onUpdate, {
        model: 'user',
        oldDoc: {
          id: authUser.id,
          name: 'Old Name',
          email: 'duplicate@example.com',
        },
        newDoc: {
          id: authUser.id,
          name: 'Canonical Name',
          email: 'duplicate@example.com',
        },
      }),
    ).rejects.toThrow(duplicateError)
    await expect(
      t.mutation(internal.auth.rebuildUserProjectionBatch, {
        cursor: null,
      }),
    ).rejects.toThrow(duplicateError)
    await expect(
      t.mutation(internal.auth.onDelete, {
        model: 'user',
        doc: { id: authUser.id },
      }),
    ).rejects.toThrow(duplicateError)

    const rows = await t.run(async (ctx) => ({
      actors: await ctx.db
        .query('users')
        .withIndex('by_subject', (q) => q.eq('subject', authUser.id))
        .collect(),
      agencyOrganization: await ctx.db.get(seeded.agencyOrganizationId),
      clientOrganization: await ctx.db.get(seeded.clientOrganizationId),
      firstMembership: await ctx.db.get(seeded.firstMembershipId),
      secondMembership: await ctx.db.get(seeded.secondMembershipId),
      project: await ctx.db.get(seeded.projectId),
      audit: await ctx.db.get(seeded.auditId),
    }))

    expect(rows.actors).toHaveLength(2)
    expect(rows.actors.map((actor) => actor._id)).toEqual(
      expect.arrayContaining([seeded.firstActorId, seeded.secondActorId]),
    )
    expect(rows.actors.map((actor) => actor.name)).toEqual(
      expect.arrayContaining(['First actor', 'Second actor']),
    )
    expect(rows.agencyOrganization?.createdBy).toBe(seeded.firstActorId)
    expect(rows.clientOrganization?.createdBy).toBe(seeded.secondActorId)
    expect(rows.firstMembership?.userId).toBe(seeded.firstActorId)
    expect(rows.secondMembership?.userId).toBe(seeded.secondActorId)
    expect(rows.project?.createdBy).toBe(seeded.secondActorId)
    expect(rows.audit?.actorUserId).toBe(seeded.firstActorId)
  })

  it('clears deleted auth PII without removing the stable actor or its references', async () => {
    const t = initConvexTest()
    const actorId = await seedUser(t, 'deleted-user')
    const organizationId = await seedOrganization(t, actorId, 'client', 'Historical client')
    const references = await t.run(async (ctx) => {
      const membership = await ctx.db
        .query('memberships')
        .withIndex('by_org_user', (q) =>
          q.eq('organizationId', organizationId).eq('userId', actorId),
        )
        .unique()
      const projectId = await ctx.db.insert('clientProjects', {
        clientOrganizationId: organizationId,
        name: 'Historical project',
        createdBy: actorId,
        createdAt: Date.now(),
      })
      const auditId = await ctx.db.insert('auditEvents', {
        organizationId,
        actorUserId: actorId,
        accessPath: 'direct',
        action: 'test.historicalReference',
        resourceType: 'clientProject',
        resourceId: projectId,
        createdAt: Date.now(),
      })
      return { membershipId: membership!._id, projectId, auditId }
    })

    await t.mutation(internal.auth.onDelete, {
      model: 'user',
      doc: {
        id: 'deleted-user',
        name: 'deleted-user',
        email: 'deleted-user@example.com',
      },
    })

    const rows = await t.run(async (ctx) => ({
      actor: await ctx.db.get(actorId),
      organization: await ctx.db.get(organizationId),
      membership: await ctx.db.get(references.membershipId),
      project: await ctx.db.get(references.projectId),
      audit: await ctx.db.get(references.auditId),
    }))

    expect(rows.actor).toMatchObject({ _id: actorId, subject: 'deleted-user' })
    expect(rows.actor).not.toHaveProperty('name')
    expect(rows.actor).not.toHaveProperty('email')
    expect(rows.organization?.createdBy).toBe(actorId)
    expect(rows.membership?.userId).toBe(actorId)
    expect(rows.project?.createdBy).toBe(actorId)
    expect(rows.audit?.actorUserId).toBe(actorId)
  })

  it('agency member can list linked client workspaces only', async () => {
    const t = convexTest(schema, modules)
    const agencyUserId = await seedUser(t, 'agency')
    const clientUserId = await seedUser(t, 'client')
    const agencyOrganizationId = await seedOrganization(t, agencyUserId, 'agency', 'Agency')
    const linkedClientId = await seedOrganization(t, clientUserId, 'client', 'Linked')
    await seedOrganization(t, clientUserId, 'client', 'Unlinked')
    await linkClient(t, agencyOrganizationId, linkedClientId)

    const clients = await t
      .withIdentity({ subject: 'agency' })
      .query(api.organizationLinks.listClients, {
        agencyOrganizationId,
      })

    expect(clients.map((client: { name: string }) => client.name)).toEqual(['Linked'])
  })

  it('agency member cannot access unlinked clients', async () => {
    const t = convexTest(schema, modules)
    const agencyUserId = await seedUser(t, 'agency')
    const clientUserId = await seedUser(t, 'client')
    const agencyOrganizationId = await seedOrganization(t, agencyUserId, 'agency', 'Agency')
    const clientOrganizationId = await seedOrganization(t, clientUserId, 'client', 'Client')

    await expect(
      t.withIdentity({ subject: 'agency' }).mutation(api.clientProjects.createForClient, {
        agencyOrganizationId,
        clientOrganizationId,
        name: 'Blocked',
      }),
    ).rejects.toThrow('Client access denied')
  })

  it('client member cannot access sibling clients', async () => {
    const t = convexTest(schema, modules)
    const clientUserId = await seedUser(t, 'client')
    await seedOrganization(t, clientUserId, 'client', 'Own')
    const siblingClientId = await t.run(async (ctx) => {
      const otherUserId = await ctx.db.insert('users', {
        subject: 'other',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      return await ctx.db.insert('organizations', {
        name: 'Sibling',
        kind: 'client',
        createdBy: otherUserId,
        createdAt: Date.now(),
      })
    })

    await expect(
      t.withIdentity({ subject: 'client' }).query(api.clientProjects.listForClient, {
        clientOrganizationId: siblingClientId,
      }),
    ).rejects.toThrow('Organization access denied')
  })

  it('revoked link removes delegated access', async () => {
    const t = convexTest(schema, modules)
    const agencyUserId = await seedUser(t, 'agency')
    const clientUserId = await seedUser(t, 'client')
    const agencyOrganizationId = await seedOrganization(t, agencyUserId, 'agency', 'Agency')
    const clientOrganizationId = await seedOrganization(t, clientUserId, 'client', 'Client')
    await linkClient(t, agencyOrganizationId, clientOrganizationId)

    await t.run(async (ctx) => {
      const link = await ctx.db
        .query('organizationLinks')
        .withIndex('by_agency_client', (q) =>
          q
            .eq('agencyOrganizationId', agencyOrganizationId)
            .eq('clientOrganizationId', clientOrganizationId),
        )
        .unique()
      await ctx.db.patch(link!._id, { status: 'revoked' })
    })

    await expect(
      t.withIdentity({ subject: 'agency' }).mutation(api.clientProjects.createForClient, {
        agencyOrganizationId,
        clientOrganizationId,
        name: 'Blocked',
      }),
    ).rejects.toThrow('Client access denied')
  })

  it('allows an administrator on the client side to revoke delegated access', async () => {
    const t = convexTest(schema, modules)
    const agencyUserId = await seedUser(t, 'agency')
    const clientUserId = await seedUser(t, 'client')
    const agencyOrganizationId = await seedOrganization(t, agencyUserId, 'agency', 'Agency')
    const clientOrganizationId = await seedOrganization(t, clientUserId, 'client', 'Client')
    await linkClient(t, agencyOrganizationId, clientOrganizationId)

    await t.withIdentity({ subject: 'client' }).mutation(api.organizationLinks.revoke, {
      agencyOrganizationId,
      clientOrganizationId,
    })

    await expect(
      t.withIdentity({ subject: 'agency' }).query(api.organizationLinks.assertClientAccess, {
        agencyOrganizationId,
        clientOrganizationId,
      }),
    ).rejects.toThrow('Client access denied')

    const audit = await t.run(async (ctx) => await ctx.db.query('auditEvents').collect())
    expect(audit).toContainEqual(
      expect.objectContaining({
        organizationId: clientOrganizationId,
        actorUserId: clientUserId,
        accessPath: 'direct',
        action: 'organizationLinks.revoke',
        resourceType: 'organizationLink',
      }),
    )
  })

  it('rejects delegated links whose organization kinds are reversed', async () => {
    const t = convexTest(schema, modules)
    const userId = await seedUser(t, 'agency')
    const wrongAgencyId = await seedOrganization(t, userId, 'client', 'Not an agency')
    const wrongClientId = await seedOrganization(t, userId, 'agency', 'Not a client')
    await linkClient(t, wrongAgencyId, wrongClientId)

    await expect(
      t.withIdentity({ subject: 'agency' }).query(api.organizationLinks.assertClientAccess, {
        agencyOrganizationId: wrongAgencyId,
        clientOrganizationId: wrongClientId,
      }),
    ).rejects.toThrow('Agency organization not found')
  })

  it('audit records delegated access path', async () => {
    const t = convexTest(schema, modules)
    const agencyUserId = await seedUser(t, 'agency')
    const clientUserId = await seedUser(t, 'client')
    const agencyOrganizationId = await seedOrganization(t, agencyUserId, 'agency', 'Agency')
    const clientOrganizationId = await seedOrganization(t, clientUserId, 'client', 'Client')
    await linkClient(t, agencyOrganizationId, clientOrganizationId)

    await t.withIdentity({ subject: 'agency' }).mutation(api.clientProjects.createForClient, {
      agencyOrganizationId,
      clientOrganizationId,
      name: 'Audit me',
    })

    const events = await t.run(async (ctx) => {
      return await ctx.db.query('auditEvents').collect()
    })

    expect(events[0]?.accessPath).toBe('delegated')
  })
})
