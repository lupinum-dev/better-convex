import {
  allOf,
  anyOf,
  custom,
  defineFunctions,
  owner,
  publicRead,
  tenant,
} from '@lupinum/better-convex-functions'

import type { Doc } from './_generated/dataModel'
import { auth } from './auth'
import { policy } from './policy'

export const fns = defineFunctions({
  auth,
  policy,
  user: (ctx, authId) =>
    ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authId))
      .unique(),
  roleOf: async (ctx, user, tenant) => {
    if (tenant.table !== 'sites') return null
    const member = await ctx.db
      .query('members')
      .withIndex('by_site_user', (q) => q.eq('siteId', tenant.id).eq('userId', user._id))
      .unique()
    return member?.role ?? null
  },
  rules: {
    users: owner('_id'),
    sites: tenant('_id'),
    members: owner('userId'),
    // Visitors see published pages; members see drafts too, as far as their role allows the
    // call's action. A live page changes only through pages.editLive (its own action, with
    // approval for agents): the condition sits here, so an operation that forgets it cannot
    // change what visitors see.
    pages: anyOf(
      publicRead((page: Doc<'pages'>) => page.status === 'published'),
      allOf(
        tenant('siteId'),
        custom<Doc<'pages'>>(
          (ctx, page) =>
            ctx.mode === 'read' || page.status === 'draft' || ctx.action === 'pages.editLive',
        ),
      ),
    ),
  },
})

export const { query, mutation } = fns
