import { callTool } from '@lupinum/better-convex-agents/test'
import { unguardedFunctions } from '@lupinum/better-convex-functions/test'
import { grantMcp, signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { describe, expect, it } from 'vitest'

import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { tools } from './agents'
import { initConvexTest, modules } from './test.setup'

// A content app: Ginko CMS pages. Visitors read published pages, members edit drafts, and a
// change to a live page by an agent waits for a person.

type Test = ReturnType<typeof initConvexTest>

/**
 * Site A: Ann owns it, Eve edits; a live home page and a draft. Site B: Bob owns it; its two
 * pages are the canaries no one in A may reach.
 */
async function setup() {
  const t = initConvexTest()
  const ids = await t.run(async (ctx) => {
    const user = (authId: string) => ctx.db.insert('users', { authId, name: authId })
    const [ann, eve, bob] = [await user('ann'), await user('eve'), await user('bob')]
    const a = await ctx.db.insert('sites', { name: 'A' })
    const b = await ctx.db.insert('sites', { name: 'B' })
    await ctx.db.insert('members', { siteId: a, userId: ann, role: 'owner' })
    await ctx.db.insert('members', { siteId: a, userId: eve, role: 'editor' })
    await ctx.db.insert('members', { siteId: b, userId: bob, role: 'owner' })
    const page = (siteId: Id<'sites'>, slug: string, status: 'draft' | 'published') =>
      ctx.db.insert('pages', { siteId, slug, title: `${slug} title`, body: `${slug} body`, status })
    return {
      a,
      b,
      home: await page(a, 'home', 'published'),
      launch: await page(a, 'launch', 'draft'),
      bLive: await page(b, 'b-live', 'published'),
      bDraft: await page(b, 'b-secret', 'draft'),
    }
  })
  return { t, ...ids }
}

// Catches a function built with Convex's own builders instead of the ones from ./functions.
it('every function goes through the policy and the row rules', async () => {
  const trustedRoutes = { '/api/auth/': 'Better Auth endpoints; the auth library checks each one.' }
  expect(await unguardedFunctions(modules, { trustedRoutes })).toEqual([])
})

// Catches a draft that visitors can see, and an agent that changes a live page without a person.
it("an agent edits a draft at once; its edit of the live page waits for the owner's yes", async () => {
  const { t, a, home, launch } = await setup()
  await expect(t.query(api.pages.bySlug, { siteId: a, slug: 'launch' })).resolves.toBeNull()

  const eve = await grantMcp(t, 'eve', ['read', 'write'])
  await expect(
    callTool(t, tools, eve, 'edit_page', { siteId: a, pageId: launch, body: 'New body' }),
  ).resolves.toMatchObject({ status: 'done', result: { body: 'New body' } })

  const agent = await grantMcp(t, 'ann', ['read', 'write'])
  const asked = await callTool(t, tools, agent, 'edit_live_page', {
    siteId: a,
    pageId: home,
    title: 'Spring sale',
  })
  expect(asked).toMatchObject({
    status: 'needs_approval',
    summary: 'Change the live page "home title".',
  })
  if (asked.status !== 'needs_approval') throw new Error('The edit did not wait.')
  await expect(t.query(api.pages.bySlug, { siteId: a, slug: 'home' })).resolves.toMatchObject({
    title: 'home title',
  })

  const ann = await signInAs(t, 'ann')
  await expect(ann.mutation(api.agents.approve, { approvalId: asked.approvalId })).resolves.toEqual(
    { status: 'approved' },
  )
  await expect(t.query(api.pages.bySlug, { siteId: a, slug: 'home' })).resolves.toMatchObject({
    title: 'Spring sale',
  })
})

type Setup = Awaited<ReturnType<typeof setup>>
/** The site a call names, a draft and a live page. */
type Target = { siteId: Id<'sites'>; draftId: Id<'pages'>; liveId: Id<'pages'> }
type Actor = Awaited<ReturnType<typeof actor>>
type Call = (t: Test, actor: Actor, target: Target) => Promise<unknown>

/** Ann on the web, and her agent with every scope. */
async function actor(t: Test) {
  return { web: await signInAs(t, 'ann'), agent: await grantMcp(t, 'ann', ['read', 'write']) }
}

const edit = { title: 'Pwned', body: 'Pwned' }
const calls: Record<string, Call> = {
  'pages.list': (_t, a, { siteId }) => a.web.query(api.pages.list, { siteId }),
  'pages.read': (_t, a, { siteId, draftId }) =>
    a.web.query(api.pages.read, { siteId, pageId: draftId }),
  'pages.edit': (_t, a, { siteId, draftId }) =>
    a.web.mutation(api.pages.edit, { siteId, pageId: draftId, ...edit }),
  'pages.editLive': (_t, a, { siteId, liveId }) =>
    a.web.mutation(api.pages.editLive, { siteId, pageId: liveId, ...edit }),
  list_pages: (t, a, { siteId }) => callTool(t, tools, a.agent, 'list_pages', { siteId }),
  read_page: (t, a, { siteId, draftId }) =>
    callTool(t, tools, a.agent, 'read_page', { siteId, pageId: draftId }),
  edit_page: (t, a, { siteId, draftId }) =>
    callTool(t, tools, a.agent, 'edit_page', { siteId, pageId: draftId, ...edit }),
  edit_live_page: (t, a, { siteId, liveId }) =>
    callTool(t, tools, a.agent, 'edit_live_page', { siteId, pageId: liveId, ...edit }),
}

/** Ann's own pages, site B's, and site B's named under site A, where Ann is the owner. */
const targets = {
  own: (s: Setup) => ({ siteId: s.a, draftId: s.launch, liveId: s.home }),
  'site B': (s: Setup) => ({ siteId: s.b, draftId: s.bDraft, liveId: s.bLive }),
  "B's pages under A": (s: Setup) => ({ siteId: s.a, draftId: s.bDraft, liveId: s.bLive }),
}

const code = (error: unknown) => (error as { data?: { code?: string } }).data?.code ?? error

// One row per target and call, with the one code it must fail with. A list names only a site,
// so it has no row for B's pages under A. B's live page is public: a write to it is FORBIDDEN,
// not NOT_FOUND, because anyone may read it.
const rows: [Exclude<keyof typeof targets, 'own'>, string, string][] = [
  ['site B', 'pages.list', 'NOT_FOUND'],
  ['site B', 'pages.read', 'NOT_FOUND'],
  ['site B', 'pages.edit', 'NOT_FOUND'],
  ['site B', 'pages.editLive', 'NOT_FOUND'],
  ['site B', 'list_pages', 'NOT_FOUND'],
  ['site B', 'read_page', 'NOT_FOUND'],
  ['site B', 'edit_page', 'NOT_FOUND'],
  ['site B', 'edit_live_page', 'NOT_FOUND'],
  ["B's pages under A", 'pages.read', 'NOT_FOUND'],
  ["B's pages under A", 'pages.edit', 'NOT_FOUND'],
  // The plan runs for a person's call too, and refuses a page of another site as missing.
  ["B's pages under A", 'pages.editLive', 'NOT_FOUND'],
  ["B's pages under A", 'read_page', 'NOT_FOUND'],
  ["B's pages under A", 'edit_page', 'NOT_FOUND'],
  ["B's pages under A", 'edit_live_page', 'NOT_FOUND'],
]

describe("no call from site A reaches site B's pages", () => {
  it('has a call for every tool that takes an ID', () => {
    expect(Object.keys(calls).filter((name) => name.includes('_'))).toEqual(
      tools.catalog.map(({ name }) => name).filter((name) => name !== 'check_approval'),
    )
  })

  it.each(rows)('%s: %s fails with %s', async (target, name, expected) => {
    const s = await setup()
    const a = await actor(s.t)
    const state = () =>
      s.t.run(async (ctx) => ({
        pages: await ctx.db.query('pages').collect(),
        approvals: await ctx.db.query('approvals').collect(),
      }))
    const before = await state()

    await expect(
      calls[name]!(s.t, a, targets[target](s)).then(() => 'no error', code),
    ).resolves.toBe(expected)
    // Nothing changed: no page edited, and no request for a person.
    await expect(state()).resolves.toEqual(before)
    // The positive control: the same call through the same path succeeds with Ann's own pages.
    await expect(calls[name]!(s.t, a, targets.own(s))).resolves.toBeDefined()
  })
})
