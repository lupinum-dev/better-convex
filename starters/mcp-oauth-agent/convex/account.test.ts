import { signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, internal } from './_generated/api'
import { initConvexTest } from './test.setup'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const code = (error: unknown) => (error as { data?: { code?: string } }).data?.code

/** Ann owns Acme with Bob (an admin); Cat owns an organization alone. */
async function setup() {
  const test = initConvexTest()
  const ids = await test.run(async (ctx) => {
    const user = (authId: string) =>
      ctx.db.insert('users', {
        authId,
        email: `${authId}@example.com`,
        name: authId,
        active: true,
      })
    const [ann, bob, cat] = [await user('ann'), await user('bob'), await user('cat')]
    const acme = await ctx.db.insert('organizations', { name: 'Acme' })
    const solo = await ctx.db.insert('organizations', { name: 'Solo' })
    const join = (organizationId: typeof acme, userId: typeof ann, role: 'owner' | 'admin') =>
      ctx.db.insert('memberships', { organizationId, userId, role, status: 'active' })
    await join(acme, ann, 'owner')
    const bobAtAcme = await join(acme, bob, 'admin')
    await join(solo, cat, 'owner')
    const projectId = await ctx.db.insert('projects', {
      organizationId: acme,
      name: 'Roadmap',
      status: 'active',
      createdBy: ann,
    })
    return { ann, bob, cat, acme, bobAtAcme, projectId }
  })
  return { test, ...ids, session: await signInAs(test, 'ann') }
}

describe('account safeguards', () => {
  // Catches: deleting the only owner of a team that still has members, which strands the team.
  it('refuses to delete the last owner of an organization that has other members', async () => {
    const { test, bobAtAcme } = await setup()
    const refuses = (authId: string) =>
      test.query(internal.accountDeletion.refusalForDeletion, { authId })
    await expect(refuses('ann')).resolves.toBe('last-owner')
    // Bob is no owner, and Cat is alone in her organization: nobody is left without an owner.
    await expect(refuses('bob')).resolves.toBeNull()
    await expect(refuses('cat')).resolves.toBeNull()
    await test.run((ctx) => ctx.db.patch(bobAtAcme, { role: 'owner' }))
    await expect(refuses('ann')).resolves.toBeNull()
  })

  // Catches: a refusal check that reads only the first rows of a long membership history and
  // lets the last owner of a team delete their account.
  it('still refuses the last owner after 150 removed and 150 other memberships', async () => {
    const { test } = await setup()
    await test.run(async (ctx) => {
      const eve = await ctx.db.insert('users', {
        authId: 'eve',
        email: 'eve@example.com',
        name: 'eve',
        active: true,
      })
      const bob = await ctx.db.insert('users', {
        authId: 'eve-team-mate',
        email: 'mate@example.com',
        name: 'mate',
        active: true,
      })
      const join = async (
        userId: typeof eve,
        role: 'owner' | 'member',
        status: 'active' | 'removed',
      ) => {
        const organizationId = await ctx.db.insert('organizations', { name: 'Team' })
        await ctx.db.insert('memberships', { organizationId, userId, role, status })
        return organizationId
      }
      for (let i = 0; i < 150; i++) await join(eve, 'owner', 'removed')
      for (let i = 0; i < 150; i++) await join(eve, 'member', 'active')
      // The one team she owns comes last: a list of her first 100 rows never reaches it.
      const team = await join(eve, 'owner', 'active')
      await ctx.db.insert('memberships', {
        organizationId: team,
        userId: bob,
        role: 'member',
        status: 'active',
      })
    })
    await expect(
      test.query(internal.accountDeletion.refusalForDeletion, { authId: 'eve' }),
    ).resolves.toBe('last-owner')
  })

  // Catches: allowing a deletion that was too large to check.
  it('refuses when the person owns more organizations than one check can read', async () => {
    const { test } = await setup()
    await test.run(async (ctx) => {
      const dan = await ctx.db.insert('users', {
        authId: 'dan',
        email: 'dan@example.com',
        name: 'dan',
        active: true,
      })
      for (let i = 0; i < 101; i++) {
        const org = await ctx.db.insert('organizations', { name: `Own${i}` })
        await ctx.db.insert('memberships', {
          organizationId: org,
          userId: dan,
          role: 'owner',
          status: 'active',
        })
      }
    })
    await expect(
      test.query(internal.accountDeletion.refusalForDeletion, { authId: 'dan' }),
    ).resolves.toBe('too-many-teams')
  })

  // Catches: an account deletion that leaves the person's memberships and profile behind.
  it('erases the memberships and the profile of a deleted account, and keeps the team data', async () => {
    const { test, ann, bob, projectId } = await setup()
    await test.mutation(internal.auth.onDelete, { model: 'user', doc: { id: 'ann' } })
    await test.finishAllScheduledFunctions(vi.runAllTimers)
    const left = await test.run(async (ctx) => ({
      users: (await ctx.db.query('users').collect()).map((user) => user._id),
      memberships: (await ctx.db.query('memberships').collect()).map((row) => row.userId),
      project: await ctx.db.get(projectId),
    }))
    expect(left.users).not.toContain(ann)
    expect(left.memberships).not.toContain(ann)
    expect(left.memberships).toContain(bob)
    expect(left.project).toMatchObject({ name: 'Roadmap' })
  })

  // Catches: deleting an account leaves behind an organization nobody uses, or deletes a shared one.
  it('deletes the organizations only the person used, in batches, and keeps shared ones', async () => {
    const { test, ann, cat, acme, bob } = await setup()
    // Cat's organization is bigger than one step (50 rows): 120 projects, then it must still go.
    const solo = await test.run(async (ctx) => {
      const memberships = await ctx.db
        .query('memberships')
        .withIndex('by_user', (q) => q.eq('userId', cat))
        .collect()
      for (let i = 0; i < 120; i++)
        await ctx.db.insert('projects', {
          organizationId: memberships[0]!.organizationId,
          name: `P${i}`,
          status: 'active',
          createdBy: cat,
        })
      return memberships[0]!.organizationId
    })
    // An organization that has another active member by the time the step runs is left alone.
    await test.mutation(internal.accountDeletion.eraseOrganizations, {
      organizationIds: [acme],
      userId: ann,
    })
    await test.mutation(internal.auth.onDelete, { model: 'user', doc: { id: 'cat' } })
    await test.mutation(internal.auth.onDelete, { model: 'user', doc: { id: 'ann' } })
    await test.finishAllScheduledFunctions(vi.runAllTimers)
    const left = await test.run(async (ctx) => ({
      organizations: (await ctx.db.query('organizations').collect()).map((row) => row._id),
      projects: (await ctx.db.query('projects').collect()).map((row) => row.organizationId),
      memberships: (await ctx.db.query('memberships').collect()).map((row) => row.userId),
    }))
    // Cat's organization is gone with its projects; Acme (Ann and Bob) stays with its project.
    expect(left.organizations).toEqual([acme])
    expect(left.projects).toEqual([acme])
    expect(left.memberships).toEqual([bob])
    expect(left.organizations).not.toContain(solo)
  })

  // Catches: cleaning up only the first 100 organizations of a person.
  it('erases all 150 organizations the person was alone in', async () => {
    const { test, ann } = await setup()
    await test.run(async (ctx) => {
      for (let i = 0; i < 150; i++) {
        const org = await ctx.db.insert('organizations', { name: `Solo${i}` })
        await ctx.db.insert('memberships', {
          organizationId: org,
          userId: ann,
          role: 'owner',
          status: 'active',
        })
      }
    })
    await test.mutation(internal.auth.onDelete, { model: 'user', doc: { id: 'ann' } })
    await test.finishAllScheduledFunctions(vi.runAllTimers)
    const names = await test.run(async (ctx) =>
      (await ctx.db.query('organizations').collect()).map((org) => org.name),
    )
    // Acme has Bob; Cat's Solo is hers.
    expect([...names].sort()).toEqual(['Acme', 'Solo'])
  })

  // Catches: deleting another person's removed membership and their projects with the organization.
  it('keeps an organization where someone else has a removed membership', async () => {
    const { test, ann } = await setup()
    const { org, dan, danProject } = await test.run(async (ctx) => {
      const dan = await ctx.db.insert('users', {
        authId: 'dan',
        email: 'dan@example.com',
        name: 'dan',
        active: true,
      })
      const org = await ctx.db.insert('organizations', { name: 'Shared' })
      await ctx.db.insert('memberships', {
        organizationId: org,
        userId: ann,
        role: 'owner',
        status: 'active',
      })
      await ctx.db.insert('memberships', {
        organizationId: org,
        userId: dan,
        role: 'member',
        status: 'removed',
      })
      const danProject = await ctx.db.insert('projects', {
        organizationId: org,
        name: 'Dans',
        status: 'active',
        createdBy: dan,
      })
      return { org, dan, danProject }
    })
    await test.mutation(internal.auth.onDelete, { model: 'user', doc: { id: 'ann' } })
    await test.finishAllScheduledFunctions(vi.runAllTimers)
    const left = await test.run(async (ctx) => ({
      org: await ctx.db.get(org),
      project: await ctx.db.get(danProject),
      memberships: (await ctx.db.query('memberships').collect())
        .filter((row) => row.organizationId === org)
        .map((row) => row.userId),
    }))
    expect(left.org).toMatchObject({ name: 'Shared' })
    expect(left.project).toMatchObject({ name: 'Dans' })
    expect(left.memberships).toEqual([dan])
  })

  // Catches: a missing write limit on the action that creates data.
  it('limits project creation to 30 a minute per person', async () => {
    const { session, acme } = await setup()
    for (let i = 0; i < 30; i++)
      await session.mutation(api.projects.create, { organizationId: acme, name: `P${i}` })
    await expect(
      session.mutation(api.projects.create, { organizationId: acme, name: 'One too many' }),
    ).rejects.toSatisfy((error) => code(error) === 'RATE_LIMITED')
  })

  // Catches: archiving a project without leaving a trace of who did it.
  it('records who archived a project in the audit log', async () => {
    const { test, session, projectId, acme } = await setup()
    await session.mutation(api.projects.archive, { projectId })
    const rows = await test.run((ctx) => ctx.db.query('auditLog').collect())
    expect(rows).toMatchObject([
      { action: 'projects.archive', actor: { kind: 'person' }, rows: [projectId] },
    ])
    expect(rows[0]!.tenantId).toBe(acme)
  })
})
