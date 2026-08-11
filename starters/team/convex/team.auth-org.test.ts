import { describe, expect, it } from 'vitest'

import { api, components, internal } from './_generated/api'
import { initConvexTest } from './test.setup'
import {
  asActor,
  now,
  seedBetterAuthActor,
  seedBetterAuthOrganization,
  seedBetterAuthTeam,
  signUpBetterAuthUser,
} from './testHelpers'

describe('team starter auth and organization invariants', () => {
  it('projects Better Auth users through the auth trigger path', async () => {
    const t = initConvexTest()

    await t.mutation(internal.auth.onCreate, {
      model: 'user',
      doc: {
        id: 'auth_1',
        name: 'Ada',
        email: 'ada@example.com',
        image: 'https://example.com/ada.png',
      },
    })

    const users = await t.run(async (ctx) => {
      return await ctx.db.query('users').take(10)
    })

    expect(users).toHaveLength(1)
    const [projectedUser] = users
    expect(projectedUser).toMatchObject({
      authUserId: 'auth_1',
      name: 'Ada',
      email: 'ada@example.com',
      image: 'https://example.com/ada.png',
    })
  })

  it('keeps app-owned product rows separate from Better Auth ids', async () => {
    const t = initConvexTest()

    const projectId = await t.run(async (ctx) => {
      return await ctx.db.insert('projects', {
        organizationId: 'better-auth-org-id',
        teamId: 'better-auth-team-id',
        name: 'Launch',
        status: 'active',
        createdByAuthUserId: 'better-auth-user-id',
        createdAt: 1,
        updatedAt: 1,
      })
    })

    const auditEventId = await t.run(async (ctx) => {
      return await ctx.db.insert('auditEvents', {
        organizationId: 'better-auth-org-id',
        teamId: 'better-auth-team-id',
        actor: {
          kind: 'user',
          authUserId: 'better-auth-user-id',
        },
        action: 'project.create',
        resourceType: 'project',
        source: 'ui',
        resourceId: projectId,
        summary: 'Created project Launch',
        createdAt: 1,
      })
    })

    const rows = await t.run(async (ctx) => {
      return {
        projects: await ctx.db.query('projects').take(10),
        auditEvents: await ctx.db.query('auditEvents').take(10),
      }
    })

    expect(rows.projects).toHaveLength(1)
    const [project] = rows.projects
    expect(project).toMatchObject({
      _id: projectId,
      organizationId: 'better-auth-org-id',
      teamId: 'better-auth-team-id',
      status: 'active',
      createdByAuthUserId: 'better-auth-user-id',
    })
    expect(rows.auditEvents).toHaveLength(1)
    const [auditEvent] = rows.auditEvents
    expect(auditEvent).toMatchObject({
      _id: auditEventId,
      organizationId: 'better-auth-org-id',
      teamId: 'better-auth-team-id',
      actor: {
        kind: 'user',
        authUserId: 'better-auth-user-id',
      },
      action: 'project.create',
      source: 'ui',
      resourceId: projectId,
    })
  })

  it('lists only the caller organizations with Better Auth roles', async () => {
    const t = initConvexTest()
    const visibleOrganizationId = await seedBetterAuthOrganization(t, { name: 'org_visible' })
    const hiddenOrganizationId = await seedBetterAuthOrganization(t, { name: 'org_hidden' })
    const actorSeed = await seedBetterAuthActor(t, {
      label: 'org_list_actor',
      organizationId: visibleOrganizationId,
      role: 'admin',
    })
    await seedBetterAuthActor(t, {
      label: 'org_list_other',
      organizationId: hiddenOrganizationId,
      role: 'owner',
    })

    const actor = asActor(t, {
      userId: actorSeed.authUserId,
      sessionId: actorSeed.sessionId,
    })
    const organizations = await actor.query(api.organizations.listMine, {})

    expect(organizations).toEqual([
      {
        id: visibleOrganizationId,
        name: 'org_visible',
        role: 'admin',
      },
    ])
  })

  it('creates organizations through Better Auth and exposes them in the Convex list', async () => {
    const t = initConvexTest()
    const creatorSeed = await signUpBetterAuthUser(t, {
      label: 'organization_creator',
    })
    const creator = asActor(t, {
      userId: creatorSeed.authUserId,
      sessionId: creatorSeed.sessionId,
    })

    const organization = await creator.mutation(api.organizations.create, {
      name: 'Created Org',
    })
    const organizations = await creator.query(api.organizations.listMine, {})
    const rows = await t.run(async (ctx) => {
      const teams = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'team',
        where: [{ field: 'organizationId', value: organization.id }],
        paginationOpts: { cursor: null, numItems: 10 },
      })) as unknown as { page: Array<{ organizationId: string }> }
      const members = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        where: [{ field: 'organizationId', value: organization.id }],
        paginationOpts: { cursor: null, numItems: 10 },
      })) as unknown as {
        page: Array<{ organizationId: string; role: string; userId: string }>
      }

      return { teams: teams.page, members: members.page }
    })

    expect(organizations).toContainEqual({
      id: organization.id,
      name: 'Created Org',
      role: 'owner',
    })
    expect(rows.teams).toHaveLength(1)
    expect(rows.members).toHaveLength(1)
    expect(rows.members[0]).toMatchObject({
      organizationId: organization.id,
      role: 'owner',
      userId: creatorSeed.authUserId,
    })
  })

  it('renames organizations and reflects the change in listMine', async () => {
    const t = initConvexTest()
    const creatorSeed = await signUpBetterAuthUser(t, {
      label: 'organization_rename_owner',
    })
    const creator = asActor(t, {
      userId: creatorSeed.authUserId,
      sessionId: creatorSeed.sessionId,
    })
    const organization = await creator.mutation(api.organizations.create, {
      name: 'Before Rename',
    })

    await creator.mutation(api.organizations.rename, {
      organizationId: organization.id,
      name: 'After Rename',
    })

    const organizations = await creator.query(api.organizations.listMine, {})
    expect(organizations).toContainEqual({
      id: organization.id,
      name: 'After Rename',
      role: 'owner',
    })
  })

  it('renames teams and reflects the change in the organization team list', async () => {
    const t = initConvexTest()
    const organizationId = await seedBetterAuthOrganization(t, { name: 'org_team_rename' })
    const teamId = await seedBetterAuthTeam(t, {
      organizationId,
      teamId: 'team_rename',
      name: 'Before Rename',
    })
    const ownerSeed = await seedBetterAuthActor(t, {
      label: 'owner_team_rename',
      organizationId,
      role: 'owner',
    })
    const owner = asActor(t, {
      userId: ownerSeed.authUserId,
      sessionId: ownerSeed.sessionId,
    })

    const renamedTeam = await owner.mutation(api.teams.rename, {
      teamId,
      name: 'After Rename',
    })
    const teams = await owner.query(api.organizations.listTeams, { organizationId })

    expect(renamedTeam).toEqual({
      id: teamId,
      name: 'After Rename',
      organizationId,
    })
    expect(teams).toContainEqual({
      id: teamId,
      name: 'After Rename',
      organizationId,
    })
  })

  it('rejects renaming a missing team', async () => {
    const t = initConvexTest()
    const ownerSeed = await signUpBetterAuthUser(t, {
      label: 'missing_team_rename_owner',
    })
    const owner = asActor(t, {
      userId: ownerSeed.authUserId,
      sessionId: ownerSeed.sessionId,
    })

    await expect(
      owner.mutation(api.teams.rename, {
        teamId: 'missing-team-id',
        name: 'Missing Team',
      }),
    ).rejects.toThrow(/Team not found/)
  })

  it('renames a team even when the session active organization points elsewhere', async () => {
    const t = initConvexTest()
    const primaryOrganizationId = await seedBetterAuthOrganization(t, {
      name: 'org_team_rename_primary',
    })
    const targetOrganizationId = await seedBetterAuthOrganization(t, {
      name: 'org_team_rename_target',
    })
    const targetTeamId = await seedBetterAuthTeam(t, {
      organizationId: targetOrganizationId,
      teamId: 'team_rename_target',
      name: 'Target Team',
    })
    const ownerSeed = await seedBetterAuthActor(t, {
      label: 'owner_team_rename_context',
      organizationId: primaryOrganizationId,
      role: 'owner',
    })

    await t.run(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.create, {
        model: 'member',
        data: {
          id: `member_${targetOrganizationId}_${ownerSeed.authUserId}`,
          organizationId: targetOrganizationId,
          userId: ownerSeed.authUserId,
          role: 'owner',
          createdAt: now,
        },
      })

      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        model: 'session',
        where: [{ field: 'id', value: ownerSeed.sessionId }],
        update: {
          activeOrganizationId: primaryOrganizationId,
        },
      })
    })

    const owner = asActor(t, {
      userId: ownerSeed.authUserId,
      sessionId: ownerSeed.sessionId,
    })

    const renamedTeam = await owner.mutation(api.teams.rename, {
      teamId: targetTeamId,
      name: 'Renamed Across Active Org',
    })
    const teams = await owner.query(api.organizations.listTeams, {
      organizationId: targetOrganizationId,
    })

    expect(renamedTeam).toEqual({
      id: targetTeamId,
      name: 'Renamed Across Active Org',
      organizationId: targetOrganizationId,
    })
    expect(teams).toContainEqual({
      id: targetTeamId,
      name: 'Renamed Across Active Org',
      organizationId: targetOrganizationId,
    })
  })
})
