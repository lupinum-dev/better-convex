import { describe, expect, it } from 'vitest'

import { api, components } from './_generated/api'
import { initConvexTest } from './test.setup'
import {
  asActor,
  now,
  seedBetterAuthActor,
  seedBetterAuthOrganization,
  seedBetterAuthTeam,
  signUpBetterAuthUser,
} from './testHelpers'

describe('team starter memberships and invitations', () => {
  it('maps Better Auth team membership rows to app-owned DTOs', async () => {
    const t = initConvexTest()
    const organizationId = await seedBetterAuthOrganization(t, { name: 'org_team_members' })
    const teamId = await seedBetterAuthTeam(t, {
      organizationId,
      teamId: 'team_members',
    })
    const ownerSeed = await seedBetterAuthActor(t, {
      label: 'owner_team_members',
      organizationId,
      role: 'owner',
    })
    const memberSeed = await seedBetterAuthActor(t, {
      label: 'member_team_members',
      organizationId,
      role: 'member',
      teamIds: [teamId],
    })

    const owner = asActor(t, {
      userId: ownerSeed.authUserId,
      sessionId: ownerSeed.sessionId,
    })
    const teamMembers = await owner.query(api.organizations.listMembers, {
      organizationId,
      teamId,
      paginationOpts: { cursor: null, numItems: 50 },
    })

    expect(
      teamMembers.page.filter((member) => member.isTeamMember).map((member) => member.userId),
    ).toEqual([memberSeed.authUserId])
  })

  it('lists teams by organization scope and visibility rules', async () => {
    const t = initConvexTest()
    const organizationId = await seedBetterAuthOrganization(t, { name: 'org_teams_scope' })
    const otherOrganizationId = await seedBetterAuthOrganization(t, { name: 'org_other_scope' })
    const visibleTeamId = await seedBetterAuthTeam(t, {
      organizationId,
      teamId: 'team_visible',
      name: 'Visible Team',
    })
    await seedBetterAuthTeam(t, {
      organizationId,
      teamId: 'team_hidden',
      name: 'Hidden Team',
    })
    await seedBetterAuthTeam(t, {
      organizationId: otherOrganizationId,
      teamId: 'team_other_org',
      name: 'Other Org Team',
    })

    const ownerSeed = await seedBetterAuthActor(t, {
      label: 'owner_teams_scope',
      organizationId,
      role: 'owner',
    })
    const memberSeed = await seedBetterAuthActor(t, {
      label: 'member_teams_scope',
      organizationId,
      role: 'member',
      teamIds: [visibleTeamId],
    })
    await t.run(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.create, {
        model: 'member',
        data: {
          id: `member_${otherOrganizationId}_${memberSeed.authUserId}`,
          organizationId: otherOrganizationId,
          userId: memberSeed.authUserId,
          role: 'member',
          createdAt: now,
        },
      })
    })

    const owner = asActor(t, {
      userId: ownerSeed.authUserId,
      sessionId: ownerSeed.sessionId,
    })
    const member = asActor(t, {
      userId: memberSeed.authUserId,
      sessionId: memberSeed.sessionId,
    })

    const ownerTeams = await owner.query(api.organizations.listTeams, {
      organizationId,
    })
    const memberTeams = await member.query(api.organizations.listTeams, {
      organizationId,
    })

    expect(ownerTeams.every((team) => team.organizationId === organizationId)).toBe(true)
    expect(ownerTeams.map((team) => team.name).sort()).toEqual(['Hidden Team', 'Visible Team'])
    expect(memberTeams).toEqual([
      {
        id: visibleTeamId,
        name: 'Visible Team',
        organizationId,
      },
    ])
  })

  it('lists enriched members with valid roles', async () => {
    const t = initConvexTest()
    const organizationId = await seedBetterAuthOrganization(t, { name: 'org_member_list' })
    const ownerSeed = await seedBetterAuthActor(t, {
      label: 'owner_member_list',
      organizationId,
      role: 'owner',
    })
    const adminSeed = await seedBetterAuthActor(t, {
      label: 'admin_member_list',
      organizationId,
      role: 'admin',
    })
    const owner = asActor(t, {
      userId: ownerSeed.authUserId,
      sessionId: ownerSeed.sessionId,
    })

    const members = await owner.query(api.organizations.listMembers, {
      organizationId,
      paginationOpts: { cursor: null, numItems: 50 },
    })

    expect(members.page).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId,
          userId: ownerSeed.authUserId,
          role: 'owner',
          user: expect.objectContaining({
            email: 'owner_member_list@example.com',
          }),
        }),
        expect.objectContaining({
          organizationId,
          userId: adminSeed.authUserId,
          role: 'admin',
          user: expect.objectContaining({
            email: 'admin_member_list@example.com',
          }),
        }),
      ]),
    )
  })

  it('changes member roles and removal affects downstream authorization', async () => {
    const t = initConvexTest()
    const organizationId = await seedBetterAuthOrganization(t, { name: 'org_membership_lifecycle' })
    const teamId = await seedBetterAuthTeam(t, {
      organizationId,
      teamId: 'team_membership_lifecycle',
    })
    const ownerSeed = await seedBetterAuthActor(t, {
      label: 'owner_membership_lifecycle',
      organizationId,
      role: 'owner',
    })
    const memberSeed = await seedBetterAuthActor(t, {
      label: 'member_membership_lifecycle',
      organizationId,
      role: 'member',
      teamIds: [teamId],
    })
    const owner = asActor(t, {
      userId: ownerSeed.authUserId,
      sessionId: ownerSeed.sessionId,
    })
    const member = asActor(t, {
      userId: memberSeed.authUserId,
      sessionId: memberSeed.sessionId,
    })

    const memberRows = await owner.query(api.organizations.listMembers, {
      organizationId,
      paginationOpts: { cursor: null, numItems: 50 },
    })
    const memberRow = memberRows.page.find((row) => row.userId === memberSeed.authUserId)
    if (!memberRow) {
      throw new Error('Expected member row to exist')
    }
    const projectId = await member.mutation(api.projects.create, {
      teamId,
      name: 'Mutable Role Project',
    })

    await owner.mutation(api.organizations.changeMemberRole, {
      organizationId,
      memberId: memberRow.id,
      role: 'viewer',
    })

    await expect(
      member.mutation(api.projects.rename, {
        projectId,
        name: 'Should Fail',
      }),
    ).rejects.toThrow(/Missing project:update permission/)

    await owner.mutation(api.organizations.removeMember, {
      organizationId,
      memberId: memberRow.id,
    })

    await expect(
      member.query(api.organizations.listTeams, {
        organizationId,
      }),
    ).rejects.toThrow(/User is not an organization member/)
  })

  it('completes the invitation lifecycle into organization and team membership', async () => {
    const t = initConvexTest()
    const organizationId = await seedBetterAuthOrganization(t, { name: 'org_invite_accept' })
    const teamId = await seedBetterAuthTeam(t, {
      organizationId,
      teamId: 'team_invite_accept',
    })
    const ownerSeed = await seedBetterAuthActor(t, {
      label: 'owner_invite_accept',
      organizationId,
      role: 'owner',
    })
    const inviteeSeed = await signUpBetterAuthUser(t, {
      label: 'invitee_accept',
    })

    const owner = asActor(t, {
      userId: ownerSeed.authUserId,
      sessionId: ownerSeed.sessionId,
    })
    await owner.mutation(api.organizations.inviteMember, {
      organizationId,
      email: 'invitee_accept@example.com',
      role: 'member',
      teamId,
    })

    const invitationId = await t.run(async (ctx) => {
      const invitation = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: 'invitation',
        where: [
          { field: 'organizationId', value: organizationId },
          { field: 'email', value: 'invitee_accept@example.com' },
          { field: 'status', value: 'pending' },
        ],
      })) as { id: string } | null

      return invitation?.id ?? null
    })
    if (!invitationId) {
      throw new Error('Expected invitation row to exist')
    }

    const invitee = asActor(t, {
      userId: inviteeSeed.authUserId,
      sessionId: inviteeSeed.sessionId,
    })
    const invitation = await invitee.query(api.invitations.get, {
      invitationId,
    })
    expect(invitation).toMatchObject({
      organizationId,
      email: 'invitee_accept@example.com',
      role: 'member',
      teamId,
      status: 'pending',
    })

    await invitee.mutation(api.invitations.accept, {
      invitationId,
    })

    const [memberRow, teamMemberRow] = await t.run(async (ctx) => {
      return await Promise.all([
        ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: 'member',
          where: [
            { field: 'organizationId', value: organizationId },
            { field: 'userId', value: inviteeSeed.authUserId },
          ],
        }),
        ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: 'teamMember',
          where: [
            { field: 'teamId', value: teamId },
            { field: 'userId', value: inviteeSeed.authUserId },
          ],
        }),
      ])
    })

    expect(memberRow).toMatchObject({
      organizationId,
      userId: inviteeSeed.authUserId,
      role: 'member',
    })
    expect(teamMemberRow).toMatchObject({
      teamId,
      userId: inviteeSeed.authUserId,
    })
  })

  it('can reject an invitation without creating membership rows', async () => {
    const t = initConvexTest()
    const organizationId = await seedBetterAuthOrganization(t, { name: 'org_invite_reject' })
    const ownerSeed = await seedBetterAuthActor(t, {
      label: 'owner_invite_reject',
      organizationId,
      role: 'owner',
    })
    const inviteeSeed = await signUpBetterAuthUser(t, {
      label: 'invitee_reject',
    })

    const owner = asActor(t, {
      userId: ownerSeed.authUserId,
      sessionId: ownerSeed.sessionId,
    })
    await owner.mutation(api.organizations.inviteMember, {
      organizationId,
      email: 'invitee_reject@example.com',
      role: 'viewer',
    })

    const invitationId = await t.run(async (ctx) => {
      const invitation = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: 'invitation',
        where: [
          { field: 'organizationId', value: organizationId },
          { field: 'email', value: 'invitee_reject@example.com' },
          { field: 'status', value: 'pending' },
        ],
      })) as { id: string } | null

      return invitation?.id ?? null
    })
    if (!invitationId) {
      throw new Error('Expected invitation row to exist')
    }

    const invitee = asActor(t, {
      userId: inviteeSeed.authUserId,
      sessionId: inviteeSeed.sessionId,
    })
    await invitee.mutation(api.invitations.reject, {
      invitationId,
    })

    const memberRow = await t.run(async (ctx) => {
      return await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: 'member',
        where: [
          { field: 'organizationId', value: organizationId },
          { field: 'userId', value: inviteeSeed.authUserId },
        ],
      })
    })

    expect(memberRow).toBeNull()
  })

  it('does not reveal whether an invitation belongs to another recipient or is missing', async () => {
    const t = initConvexTest()
    const organizationId = await seedBetterAuthOrganization(t, { name: 'org_invite_oracle' })
    const ownerSeed = await seedBetterAuthActor(t, {
      label: 'owner_invite_recipient_oracle',
      organizationId,
      role: 'owner',
    })
    const inviteeSeed = await signUpBetterAuthUser(t, {
      label: 'invitee_recipient_oracle',
    })
    const otherUserSeed = await signUpBetterAuthUser(t, {
      label: 'other_recipient_oracle',
    })
    const owner = asActor(t, {
      userId: ownerSeed.authUserId,
      sessionId: ownerSeed.sessionId,
    })

    await owner.mutation(api.organizations.inviteMember, {
      organizationId,
      email: 'invitee_recipient_oracle@example.com',
      role: 'member',
    })
    const invitationId = await t.run(async (ctx) => {
      const invitation = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: 'invitation',
        where: [
          { field: 'organizationId', value: organizationId },
          { field: 'email', value: 'invitee_recipient_oracle@example.com' },
        ],
      })) as { id: string } | null

      return invitation?.id ?? null
    })
    if (!invitationId) {
      throw new Error('Expected invitation row to exist')
    }

    const invitee = asActor(t, {
      userId: inviteeSeed.authUserId,
      sessionId: inviteeSeed.sessionId,
    })
    const otherUser = asActor(t, {
      userId: otherUserSeed.authUserId,
      sessionId: otherUserSeed.sessionId,
    })

    await expect(otherUser.query(api.invitations.get, { invitationId })).rejects.toThrow(
      'Invitation is unavailable',
    )
    await expect(
      invitee.query(api.invitations.get, { invitationId: 'missing-invitation' }),
    ).rejects.toThrow('Invitation is unavailable')
  })

  it('lists indexed invitation teams beyond the scan bound and hides ids on cancellation', async () => {
    const t = initConvexTest()
    const organizationId = await seedBetterAuthOrganization(t, { name: 'org_invite_cancel' })
    const ownerSeed = await seedBetterAuthActor(t, {
      label: 'owner_invite_cancel',
      organizationId,
      role: 'owner',
    })
    await t.run(async (ctx) => {
      for (let index = 0; index < 201; index += 1) {
        await ctx.runMutation(components.betterAuth.adapter.create, {
          model: 'team',
          data: {
            id: `unrelated_invitation_team_${index}`,
            name: `Unrelated Invitation Team ${index}`,
            memberCount: 0,
            organizationId,
            createdAt: now,
            updatedAt: now,
          },
        })
      }
    })
    const teamId = await seedBetterAuthTeam(t, {
      organizationId,
      teamId: 'indexed_invitation_team',
      name: 'Indexed Invitation Team',
    })

    const owner = asActor(t, {
      userId: ownerSeed.authUserId,
      sessionId: ownerSeed.sessionId,
    })
    await owner.mutation(api.organizations.inviteMember, {
      organizationId,
      email: 'pending_cancel@example.com',
      role: 'admin',
      teamId,
    })

    const invitations = await owner.query(api.organizations.listInvitations, {
      organizationId,
      paginationOpts: { cursor: null, numItems: 50 },
    })
    expect(invitations.page).toEqual([
      expect.objectContaining({
        email: 'pending_cancel@example.com',
        role: 'admin',
        status: 'pending',
        teamId,
        teamName: 'Indexed Invitation Team',
      }),
    ])
    expect('id' in invitations.page[0]!).toBe(false)

    await owner.mutation(api.organizations.cancelInvitation, {
      organizationId,
      email: 'pending_cancel@example.com',
    })

    const remainingInvitations = await owner.query(api.organizations.listInvitations, {
      organizationId,
      paginationOpts: { cursor: null, numItems: 50 },
    })
    expect(remainingInvitations.page).toEqual([])
  })

  it('authorizes invitation cancellation before revealing whether a row exists', async () => {
    const t = initConvexTest()
    const organizationId = await seedBetterAuthOrganization(t, { name: 'org_invite_oracle' })
    const ownerSeed = await seedBetterAuthActor(t, {
      label: 'owner_invite_oracle',
      organizationId,
      role: 'owner',
    })
    const memberSeed = await seedBetterAuthActor(t, {
      label: 'member_invite_oracle',
      organizationId,
      role: 'member',
    })
    const owner = asActor(t, {
      userId: ownerSeed.authUserId,
      sessionId: ownerSeed.sessionId,
    })
    const member = asActor(t, {
      userId: memberSeed.authUserId,
      sessionId: memberSeed.sessionId,
    })

    await owner.mutation(api.organizations.inviteMember, {
      organizationId,
      email: 'exists@example.com',
      role: 'member',
    })

    for (const email of ['exists@example.com', 'absent@example.com']) {
      await expect(
        member.mutation(api.organizations.cancelInvitation, { organizationId, email }),
      ).rejects.toThrow('Missing member:update permission')
    }

    const invitations = await owner.query(api.organizations.listInvitations, {
      organizationId,
      paginationOpts: { cursor: null, numItems: 50 },
    })
    expect(invitations.page).toHaveLength(1)
  })

  it('adds and removes team members through the Convex teams API', async () => {
    const t = initConvexTest()
    const organizationId = await seedBetterAuthOrganization(t, { name: 'org_team_management' })
    const otherOrganizationId = await seedBetterAuthOrganization(t, {
      name: 'org_team_management_other',
    })
    const teamId = await seedBetterAuthTeam(t, {
      organizationId,
      teamId: 'team_management',
    })
    const ownerSeed = await seedBetterAuthActor(t, {
      label: 'owner_team_management',
      organizationId,
      role: 'owner',
    })
    const memberSeed = await seedBetterAuthActor(t, {
      label: 'member_team_management',
      organizationId,
      role: 'member',
    })
    const outsiderSeed = await seedBetterAuthActor(t, {
      label: 'outsider_team_management',
      organizationId: otherOrganizationId,
      role: 'owner',
    })

    const owner = asActor(t, {
      userId: ownerSeed.authUserId,
      sessionId: ownerSeed.sessionId,
    })
    const outsider = asActor(t, {
      userId: outsiderSeed.authUserId,
      sessionId: outsiderSeed.sessionId,
    })

    await owner.mutation(api.teams.addMember, {
      teamId,
      userId: memberSeed.authUserId,
    })
    let members = await owner.query(api.organizations.listMembers, {
      organizationId,
      teamId,
      paginationOpts: { cursor: null, numItems: 50 },
    })
    expect(members.page.find((member) => member.userId === memberSeed.authUserId)).toMatchObject({
      isTeamMember: true,
    })

    await expect(
      outsider.mutation(api.teams.addMember, {
        teamId,
        userId: outsiderSeed.authUserId,
      }),
    ).rejects.toThrow(/permission|organization member|organization/i)

    await owner.mutation(api.teams.removeMember, {
      teamId,
      userId: memberSeed.authUserId,
    })
    members = await owner.query(api.organizations.listMembers, {
      organizationId,
      teamId,
      paginationOpts: { cursor: null, numItems: 50 },
    })
    expect(members.page.find((member) => member.userId === memberSeed.authUserId)).toMatchObject({
      isTeamMember: false,
    })
  })
})
