import { describe, expect, it } from 'vitest'

import { api, components } from './_generated/api'
import { initConvexTest } from './test.setup'
import {
  asActor,
  seedBetterAuthActor,
  seedBetterAuthOrganization,
  seedBetterAuthTeam,
  signUpBetterAuthUser,
} from './testHelpers'

// Compile-time evidence that maintenance functions and cron registrations are
// filtered out of the generated public API. Convex runtime visibility remains
// the enforcement boundary. Referencing the function keeps this check in the
// TypeScript program without executing it at runtime.
function assertInternalFunctionsStayPrivate(): void {
  // @ts-expect-error rebuildUserProjectionBatch is internal-only.
  void api.auth.rebuildUserProjectionBatch
  // @ts-expect-error purgeSoftDeleted is internal-only.
  void api.projects.purgeSoftDeleted
  // @ts-expect-error the cron registration is not a callable public function.
  void api.crons.default
}
void assertInternalFunctionsStayPrivate

describe('team public authorization matrix', () => {
  it('directly denies anonymous and expired sessions on uncovered operations', async () => {
    const t = initConvexTest()
    const organizationId = await seedBetterAuthOrganization(t, { name: 'anonymous_matrix_org' })
    const teamId = await seedBetterAuthTeam(t, {
      organizationId,
      teamId: 'anonymous_matrix_team',
    })
    const projectId = await t.run(async (ctx) => {
      return await ctx.db.insert('projects', {
        organizationId,
        teamId,
        name: 'Deleted Matrix Project',
        status: 'deleted',
        createdByAuthUserId: 'matrix-owner',
        createdAt: 1,
        updatedAt: 1,
        deletedAt: 1,
        deletedByAuthUserId: 'matrix-owner',
      })
    })

    // listMine is intentionally soft-authenticated for signed-out navigation;
    // it exposes no organization rows without a live Better Auth session.
    await expect(t.query(api.organizations.listMine, {})).resolves.toEqual([])
    await expect(t.query(api.organizations.getCapabilities, { organizationId })).rejects.toThrow(
      'Unauthenticated',
    )
    await expect(
      t.mutation(api.organizations.create, { name: 'Anonymous Organization' }),
    ).rejects.toThrow('Unauthenticated')
    await expect(
      t.mutation(api.organizations.createTeam, { organizationId, name: 'Anonymous Team' }),
    ).rejects.toThrow('Unauthenticated')
    await expect(t.query(api.teams.getCapabilities, { teamId })).rejects.toThrow('Unauthenticated')
    await expect(
      t.mutation(api.teams.rename, { teamId, name: 'Anonymous Team Rename' }),
    ).rejects.toThrow('Unauthenticated')
    await expect(
      t.query(api.audit.listForTeam, {
        teamId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow('Unauthenticated')
    await expect(
      t.mutation(api.organizations.rename, { organizationId, name: 'Anonymous Rename' }),
    ).rejects.toThrow('Unauthenticated')
    await expect(
      t.query(api.organizations.listMembers, {
        organizationId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow('Unauthenticated')
    await expect(
      t.query(api.organizations.listInvitations, {
        organizationId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow('Unauthenticated')
    await expect(
      t.mutation(api.organizations.inviteMember, {
        organizationId,
        email: 'anonymous@example.com',
        role: 'member',
      }),
    ).rejects.toThrow('Unauthenticated')
    await expect(
      t.mutation(api.organizations.changeMemberRole, {
        organizationId,
        memberId: 'member-id',
        role: 'viewer',
      }),
    ).rejects.toThrow('Unauthenticated')
    await expect(
      t.mutation(api.organizations.removeMember, {
        organizationId,
        memberId: 'member-id',
      }),
    ).rejects.toThrow('Unauthenticated')
    await expect(
      t.mutation(api.teams.removeMember, { teamId, userId: 'member-id' }),
    ).rejects.toThrow('Unauthenticated')
    await expect(t.query(api.projects.getCreateRateLimit, { teamId })).rejects.toThrow(
      'Unauthenticated',
    )
    await expect(t.mutation(api.projects.restore, { projectId })).rejects.toThrow('Unauthenticated')
    await expect(t.query(api.invitations.get, { invitationId: 'invitation-id' })).rejects.toThrow(
      'Unauthenticated',
    )
    await expect(
      t.mutation(api.invitations.accept, { invitationId: 'invitation-id' }),
    ).rejects.toThrow('Unauthenticated')
    await expect(
      t.mutation(api.invitations.reject, { invitationId: 'invitation-id' }),
    ).rejects.toThrow('Unauthenticated')
    await expect(t.query(api.users.getCurrent, {})).resolves.toBeNull()

    const expiredSeed = await signUpBetterAuthUser(t, { label: 'expired_matrix_user' })
    await t.run(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        model: 'session',
        where: [{ field: 'id', value: expiredSeed.sessionId }],
        update: { expiresAt: Date.now() - 1 },
      })
    })
    const expired = asActor(t, {
      userId: expiredSeed.authUserId,
      sessionId: expiredSeed.sessionId,
    })

    await expect(expired.query(api.users.getCurrent, {})).resolves.toBeNull()
    await expect(
      expired.mutation(api.organizations.create, { name: 'Expired Organization' }),
    ).rejects.toThrow('Unauthenticated')
  })

  it('rechecks tenant membership, team membership, and role on capability and audit reads', async () => {
    const t = initConvexTest()
    const organizationId = await seedBetterAuthOrganization(t, { name: 'matrix_org' })
    const otherOrganizationId = await seedBetterAuthOrganization(t, { name: 'matrix_other_org' })
    const teamId = await seedBetterAuthTeam(t, { organizationId, teamId: 'matrix_team' })
    const otherTeamId = await seedBetterAuthTeam(t, {
      organizationId,
      teamId: 'matrix_other_team',
    })
    const viewerSeed = await seedBetterAuthActor(t, {
      label: 'matrix_viewer',
      organizationId,
      role: 'viewer',
      teamIds: [teamId],
    })
    const viewer = asActor(t, {
      userId: viewerSeed.authUserId,
      sessionId: viewerSeed.sessionId,
    })

    await expect(
      viewer.query(api.organizations.getCapabilities, { organizationId: otherOrganizationId }),
    ).rejects.toThrow('User is not an organization member')
    await expect(
      viewer.mutation(api.teams.rename, { teamId, name: 'Viewer Team Rename' }),
    ).rejects.toThrow('You are not allowed to update this team')
    await expect(
      viewer.mutation(api.organizations.createTeam, {
        organizationId,
        name: 'Viewer Team',
      }),
    ).rejects.toThrow('You are not allowed to create teams in this organization')
    await expect(viewer.query(api.teams.getCapabilities, { teamId: otherTeamId })).rejects.toThrow(
      'User is not a member of the team',
    )
    await expect(
      viewer.query(api.audit.listForTeam, {
        teamId: otherTeamId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow('User is not a member of the team')

    await expect(
      viewer.query(api.organizations.getCapabilities, { organizationId }),
    ).resolves.toMatchObject({ role: 'viewer' })
    await expect(viewer.query(api.teams.getCapabilities, { teamId })).resolves.toMatchObject({
      organizationId,
      teamId,
      canViewProjects: true,
    })
    await expect(
      viewer.query(api.audit.listForTeam, {
        teamId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).resolves.toMatchObject({ page: [] })
    await expect(viewer.query(api.users.getCurrent, {})).resolves.toMatchObject({
      authUserId: viewerSeed.authUserId,
    })

    await t.run(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        model: 'member',
        where: [
          { field: 'organizationId', value: organizationId },
          { field: 'userId', value: viewerSeed.authUserId },
        ],
      })
    })

    await expect(
      viewer.query(api.organizations.getCapabilities, { organizationId }),
    ).rejects.toThrow('User is not an organization member')
    await expect(viewer.query(api.teams.getCapabilities, { teamId })).rejects.toThrow(
      'User is not an organization member',
    )
  })
})
