import {
  defineFunctions,
  definePolicy,
  type RoleOf,
  anyOf,
  custom,
  owner,
  tenant,
} from '@lupinum/better-convex-functions'
import type { DocumentByName } from 'convex/server'
import { v } from 'convex/values'

import { auth, type DataModel, notUsed, orgRole, user } from './common'

// K6: a note is private to its author, or shared with an organization. Viewers may read
// shared notes but not edit them.
const policy = definePolicy({
  actions: ['notes.read', 'notes.edit'],
  roles: { owner: ['*'], viewer: ['notes.read'] },
  scopes: {},
})

const shared = {
  auth,
  policy,
  user,
  roleOf: async (ctx: any, user: { _id: any }, tenant: { table: string; id: any }) =>
    tenant.table === 'orgs'
      ? ((await orgRole(ctx, user._id, tenant.id)) as RoleOf<typeof policy> | null)
      : null,
}

const others = {
  users: owner('_id'),
  orgs: tenant('_id'),
  memberships: owner('userId'),
  ...notUsed(
    'projects',
    'workspaces',
    'docs',
    'agencies',
    'agencyMembers',
    'clients',
    'clientProjects',
    'clientContacts',
  ),
}

/** The presets: the author, or a member whose role allows the action in the note's organization. */
const presets = defineFunctions({
  ...shared,
  rules: { ...others, notes: anyOf(owner('authorId'), tenant('orgId')) },
})

/** The same rule written by hand: `ctx.allows` applies the role layer. */
const handWritten = defineFunctions({
  ...shared,
  rules: {
    ...others,
    notes: custom(async (ctx, note: DocumentByName<DataModel, 'notes'>) => {
      if (ctx.actor.kind !== 'visitor' && note.authorId === ctx.actor.user._id) return true
      return note.orgId !== undefined && (await ctx.allows({ table: 'orgs', id: note.orgId }))
    }),
  },
})

const operations = (fns: typeof presets) => ({
  read: fns.query({
    action: 'notes.read',
    args: { noteId: v.id('notes') },
    returns: v.union(v.string(), v.null()),
    handler: async (ctx, { noteId }) => (await ctx.db.get(noteId))?.text ?? null,
  }),
  edit: fns.mutation({
    action: 'notes.edit',
    args: { noteId: v.id('notes'), text: v.string() },
    returns: v.null(),
    handler: async (ctx, { noteId, text }) => {
      await ctx.db.patch(noteId, { text })
      return null
    },
  }),
})

export const { read, edit } = operations(presets)
const custom_ = operations(handWritten as unknown as typeof presets)
export const readCustom = custom_.read
export const editCustom = custom_.edit
