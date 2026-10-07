import { fail } from '@lupinum/better-convex-functions'
import type { GenericDatabaseWriter } from 'convex/server'
import { v } from 'convex/values'

import type { DataModel, Doc } from './_generated/dataModel'
import { mutation, query } from './functions'

type Page = Doc<'pages'>

const page = v.object({
  id: v.id('pages'),
  slug: v.string(),
  title: v.string(),
  body: v.string(),
  status: v.union(v.literal('draft'), v.literal('published')),
})
const view = ({ _id, slug, title, body, status }: Page) => ({ id: _id, slug, title, body, status })
const changes = { title: v.optional(v.string()), body: v.optional(v.string()) }

/** The public site: a published page by its slug, for anyone. */
export const bySlug = query({
  action: 'pages.read',
  args: { siteId: v.id('sites'), slug: v.string() },
  returns: v.union(page, v.null()),
  handler: async (ctx, { siteId, slug }) => {
    const found = await ctx.db
      .query('pages')
      .withIndex('by_site_status_slug', (q) =>
        q.eq('siteId', siteId).eq('status', 'published').eq('slug', slug),
      )
      .unique()
    return found && view(found)
  },
})

/** The editor's page list, drafts included. */
export const list = query({
  action: 'pages.preview',
  args: { siteId: v.id('sites') },
  returns: v.array(page),
  tool: { name: 'list_pages', description: 'List the pages of a site, drafts included.' },
  handler: async (ctx, { siteId }) =>
    (
      await ctx.db
        .query('pages')
        .withIndex('by_site_status_slug', (q) => q.eq('siteId', siteId))
        .take(200)
    ).map(view),
})

export const read = query({
  action: 'pages.preview',
  args: { siteId: v.id('sites'), pageId: v.id('pages') },
  returns: page,
  tool: { name: 'read_page', description: 'Read one page, draft or published.' },
  handler: async (ctx, { pageId }) =>
    view((await ctx.db.get(pageId)) ?? fail('NOT_FOUND', 'No page with this ID.')),
})

/** Edits a draft. The pages rule keeps live pages to `editLive`, so an agent cannot skip the approval. */
export const edit = mutation({
  action: 'pages.edit',
  args: { siteId: v.id('sites'), pageId: v.id('pages'), ...changes },
  returns: page,
  tool: {
    name: 'edit_page',
    description: 'Change the title or body of a draft page. A published page needs edit_live_page.',
  },
  handler: async (ctx, { pageId, title, body }) => {
    const current = (await ctx.db.get(pageId)) ?? fail('NOT_FOUND', 'No page with this ID.')
    return save(ctx, current, { title, body })
  },
})

export const editLive = mutation({
  action: 'pages.editLive',
  args: { siteId: v.id('sites'), pageId: v.id('pages'), ...changes },
  returns: page,
  tool: {
    name: 'edit_live_page',
    description: 'Change the title or body of a published page. Visitors see it at once.',
  },
  // Runs before the handler, for agents and people alike, and live pages of every site are
  // readable: refuse here what the handler could never write, so it never reaches a person.
  plan: async (ctx, { siteId, pageId }) => {
    const current = await ctx.db.get(pageId)
    if (current?.siteId !== siteId) fail('NOT_FOUND', 'No page with this ID.')
    return { summary: `Change the live page "${current.title}".`, rows: [pageId] }
  },
  handler: async (ctx, { pageId, title, body }) => {
    const current = (await ctx.db.get(pageId)) ?? fail('NOT_FOUND', 'No page with this ID.')
    if (current.status !== 'published')
      fail('INVALID_INPUT', 'pageId: this page is a draft. Change it with edit_page.')
    return save(ctx, current, { title, body })
  },
})

async function save(
  ctx: { db: GenericDatabaseWriter<DataModel> },
  current: Page,
  input: { title?: string; body?: string },
) {
  const title = input.title?.trim() ?? current.title
  if (!title || title.length > 200) fail('INVALID_INPUT', 'title: use 1 to 200 characters.')
  const next = { title, body: input.body ?? current.body }
  await ctx.db.patch(current._id, next)
  return view({ ...current, ...next })
}
