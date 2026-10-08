import { trusted } from '@lupinum/better-convex-functions'
import { v } from 'convex/values'

import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalMutation, internalQuery, type DatabaseReader } from './_generated/server'

// Rows one step deletes before it schedules the next, so no step nears Convex's per-transaction limits.
const STEP_ROWS = 50

/**
 * Called by `deleteUser.beforeDelete` in ./auth.ts, before anything is deleted. True when the
 * person is the only active owner of an organization that still has other active members:
 * deleting them would leave that team without an owner. An organization where they are the only
 * member does not count; nobody is left to lose it.
 */
export const leavesATeamWithoutOwner = trusted(
  'Called by the auth deleteUser check; it takes the Better Auth user ID and reads memberships only.',
  internalQuery({
    args: { authId: v.string() },
    handler: async (ctx, { authId }) => {
      const user = await ctx.db
        .query('users')
        .withIndex('by_auth_id', (q) => q.eq('authId', authId))
        .unique()
      if (!user) return false
      const owned = await ctx.db
        .query('memberships')
        .withIndex('by_user', (q) => q.eq('userId', user._id).eq('status', 'active'))
        .take(100)
      for (const { organizationId, role } of owned) {
        if (role !== 'owner') continue
        const members = await ctx.db
          .query('memberships')
          .withIndex('by_org_user', (q) => q.eq('organizationId', organizationId))
          .take(100)
        const others = members.filter((m) => m.status === 'active' && m.userId !== user._id)
        if (others.length > 0 && !others.some((m) => m.role === 'owner')) return true
      }
      return false
    },
  }),
)

async function hasOtherActiveMember(
  db: DatabaseReader,
  organizationId: Id<'organizations'>,
  userId: Id<'users'>,
) {
  for await (const member of db
    .query('memberships')
    .withIndex('by_org_user', (q) => q.eq('organizationId', organizationId))) {
    if (member.userId !== userId && member.status === 'active') return true
  }
  return false
}

/**
 * The organizations where this person is the only active member. Called by `onDelete` in ./auth.ts
 * while the person's memberships still exist; the erasure deletes those memberships right after.
 */
export async function organizationsOnlyUsedBy(db: DatabaseReader, userId: Id<'users'>) {
  const mine = await db
    .query('memberships')
    .withIndex('by_user', (q) => q.eq('userId', userId).eq('status', 'active'))
    .take(100)
  const alone: Id<'organizations'>[] = []
  for (const { organizationId } of mine)
    if (!(await hasOtherActiveMember(db, organizationId, userId))) alone.push(organizationId)
  return alone
}

/**
 * Deletes organizations with their projects and memberships, in batches of 50 rows, and
 * schedules itself until they are gone. An organization that got another active member since
 * `onDelete` looked is left alone.
 */
export const eraseOrganizations = trusted(
  'Account deletion: removes the organizations only this person used.',
  internalMutation({
    args: { organizationIds: v.array(v.id('organizations')), userId: v.id('users') },
    handler: async (ctx, { organizationIds, userId }) => {
      let left = STEP_ROWS
      const remaining: typeof organizationIds = []
      for (const organizationId of organizationIds) {
        if (left <= 0) {
          remaining.push(organizationId)
          continue
        }
        if (await hasOtherActiveMember(ctx.db, organizationId, userId)) continue
        const projects = await ctx.db
          .query('projects')
          .withIndex('by_org_status', (q) => q.eq('organizationId', organizationId))
          .take(left)
        for (const project of projects) await ctx.db.delete(project._id)
        left -= projects.length
        const rows = await ctx.db
          .query('memberships')
          .withIndex('by_org_user', (q) => q.eq('organizationId', organizationId))
          .take(Math.max(left, 0))
        for (const row of rows) await ctx.db.delete(row._id)
        left -= rows.length
        // Delete the organization only when nothing was left over for the next step.
        if (left > 0) await ctx.db.delete(organizationId)
        else remaining.push(organizationId)
      }
      if (remaining.length > 0)
        await ctx.scheduler.runAfter(0, internal.accountDeletion.eraseOrganizations, {
          organizationIds: remaining,
          userId,
        })
      return null
    },
  }),
)
