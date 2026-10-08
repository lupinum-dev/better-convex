import { eraseUser, trusted } from '@lupinum/better-convex-functions'
import { v } from 'convex/values'

import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalMutation, internalQuery, type DatabaseReader } from './_generated/server'

// Rows one step deletes before it schedules the next, so no step nears Convex's per-transaction limits.
const STEP_ROWS = 50

// Most owned organizations the refusal check reads. A person who owns more cannot be checked in
// one transaction, so the check refuses rather than guess.
const OWNED_TEAMS_CHECKED = 100

/**
 * Called by `deleteUser.beforeDelete` in ./auth.ts, before anything is deleted. Returns why the
 * deletion must be refused, or null:
 * - 'last-owner': the person is the only active owner of an organization that still has other
 *   active members, so deleting them would leave that team without an owner. An organization where
 *   they are the only member does not count; nobody is left to lose it.
 * - 'too-many-teams': the person owns more than 100 organizations, more than one transaction
 *   can check.
 */
export const refusalForDeletion = trusted(
  'Called by the auth deleteUser check; it takes the Better Auth user ID and reads memberships only.',
  internalQuery({
    args: { authId: v.string() },
    handler: async (ctx, { authId }) => {
      const user = await ctx.db
        .query('users')
        .withIndex('by_auth_id', (q) => q.eq('authId', authId))
        .unique()
      if (!user) return null
      const owned = await ctx.db
        .query('memberships')
        .withIndex('by_user', (q) =>
          q.eq('userId', user._id).eq('status', 'active').eq('role', 'owner'),
        )
        .take(OWNED_TEAMS_CHECKED + 1)
      if (owned.length > OWNED_TEAMS_CHECKED) return 'too-many-teams' as const
      for (const { organizationId } of owned) {
        const active = (status: 'active', role?: 'owner') =>
          ctx.db
            .query('memberships')
            .withIndex('by_org_status', (q) =>
              role
                ? q.eq('organizationId', organizationId).eq('status', status).eq('role', role)
                : q.eq('organizationId', organizationId).eq('status', status),
            )
            .take(2)
        const otherOwners = (await active('active', 'owner')).filter((m) => m.userId !== user._id)
        if (otherOwners.length > 0) continue
        const others = (await active('active')).filter((m) => m.userId !== user._id)
        if (others.length > 0) return 'last-owner' as const
      }
      return null
    },
  }),
)

/** True when any other person has a membership row in the organization, active or removed. */
async function hasOtherMember(
  db: DatabaseReader,
  organizationId: Id<'organizations'>,
  userId: Id<'users'>,
) {
  for await (const member of db
    .query('memberships')
    .withIndex('by_org_user', (q) => q.eq('organizationId', organizationId))) {
    if (member.userId !== userId) return true
  }
  return false
}

// Memberships one step looks at while it searches for organizations only this person used.
const SCAN_PAGE = 100

/**
 * Starts the account cleanup that `onDelete` in ./auth.ts schedules. It pages through the
 * person's memberships, hands every organization nobody else ever belonged to (no other row, active
 * or removed) to `eraseOrganizations`, and schedules itself until the last page. Then it starts the
 * person's own erasure, so their memberships are still there while this step looks for them.
 */
export const scanOrganizations = trusted(
  'Account deletion: finds the organizations only this person used.',
  internalMutation({
    args: { userId: v.id('users'), cursor: v.union(v.string(), v.null()) },
    handler: async (ctx, { userId, cursor }) => {
      const page = await ctx.db
        .query('memberships')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .paginate({ numItems: SCAN_PAGE, cursor })
      const alone: Id<'organizations'>[] = []
      for (const { organizationId } of page.page)
        if (!(await hasOtherMember(ctx.db, organizationId, userId))) alone.push(organizationId)
      if (alone.length > 0)
        await ctx.scheduler.runAfter(0, internal.accountDeletion.eraseOrganizations, {
          organizationIds: alone,
          userId,
        })
      if (page.isDone) await eraseUser(ctx, userId, internal.erasure.eraseStep)
      else
        await ctx.scheduler.runAfter(0, internal.accountDeletion.scanOrganizations, {
          userId,
          cursor: page.continueCursor,
        })
      return null
    },
  }),
)

/**
 * Deletes organizations with their projects and memberships, in batches of 50 rows, and
 * schedules itself until they are gone. An organization that got another member since
 * the scan looked is left alone.
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
        if (await hasOtherMember(ctx.db, organizationId, userId)) continue
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
