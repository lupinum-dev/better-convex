import { callTool } from '@lupinum/better-convex-agents/test'
import { unguardedFunctions } from '@lupinum/better-convex-functions/test'
import { grantMcp, signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { describe, expect, it } from 'vitest'

import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { tools } from './agents'
import { initConvexTest, modules } from './test.setup'

// A marketplace app: one order row belongs to a buyer and a seller organization. Every call
// names the organization it acts for, and the order rule lets each side do only its own part.

type Test = ReturnType<typeof initConvexTest>

/**
 * Acme (Ann owns, Mia is a member) buys from Shop (Sam owns). Duo is a member of both. Rival
 * buys from Bazaar (Rex owns both): their order and Rival's draft listing are the canaries.
 */
async function setup() {
  const t = initConvexTest()
  const ids = await t.run(async (ctx) => {
    const user = (authId: string) => ctx.db.insert('users', { authId, name: authId })
    const [ann, mia, sam, rex, duo] = [
      await user('ann'),
      await user('mia'),
      await user('sam'),
      await user('rex'),
      await user('duo'),
    ]
    const org = (name: string) => ctx.db.insert('orgs', { name })
    const [acme, shop, rival, bazaar] = [
      await org('Acme'),
      await org('Shop'),
      await org('Rival'),
      await org('Bazaar'),
    ]
    for (const [orgId, userId, role] of [
      [acme, ann, 'owner'],
      [acme, mia, 'member'],
      [shop, sam, 'owner'],
      [rival, rex, 'owner'],
      [bazaar, rex, 'owner'],
      [acme, duo, 'member'],
      [shop, duo, 'member'],
    ] as const) {
      await ctx.db.insert('memberships', { orgId, userId, role })
    }
    const listing = (sellerOrgId: Id<'orgs'>, title: string, active: boolean) =>
      ctx.db.insert('listings', { sellerOrgId, title, active })
    const lamp = await listing(shop, 'Lamp', true)
    const vase = await listing(bazaar, 'Vase', true)
    const order = (buyerOrgId: Id<'orgs'>, sellerOrgId: Id<'orgs'>, listingId: Id<'listings'>) =>
      ctx.db.insert('orders', {
        buyerOrgId,
        sellerOrgId,
        listingId,
        item: listingId === lamp ? 'Lamp' : 'Vase',
        quantity: 2,
        status: 'placed',
      })
    return {
      acme,
      shop,
      rival,
      bazaar,
      lamp,
      draft: await listing(rival, 'Secret draft', false),
      order: await order(acme, shop, lamp),
      canary: await order(rival, bazaar, vase),
    }
  })
  return { t, ...ids }
}

// Catches a function built with Convex's own builders instead of the ones from ./functions.
it('every function goes through the policy and the row rules', async () => {
  const trustedRoutes = { '/api/auth/': 'Better Auth endpoints; the auth library checks each one.' }
  expect(await unguardedFunctions(modules, { trustedRoutes })).toEqual([])
})

// Catches a seller who cannot see the buyer's order, and a cancel by an agent without a person.
it("the buyer's agent orders, the seller's agent ships, and a cancel waits for a person", async () => {
  const { t, acme, shop, lamp, order } = await setup()
  const status = async (id: Id<'orders'>) => (await t.run((ctx) => ctx.db.get(id)))?.status

  const mia = await grantMcp(t, 'mia', ['read', 'write'])
  const placed = await callTool(t, tools, mia, 'place_order', {
    orgId: acme,
    listingId: lamp,
    quantity: 3,
  })
  if (placed.status !== 'done') throw new Error('The order did not go through.')
  const sam = await grantMcp(t, 'sam', ['read', 'write'])
  await expect(
    callTool(t, tools, sam, 'list_orders', { orgId: shop, side: 'selling' }),
  ).resolves.toMatchObject({
    status: 'done',
    result: [
      { id: order, item: 'Lamp', quantity: 2, status: 'placed' },
      { id: placed.result, item: 'Lamp', quantity: 3, status: 'placed' },
    ],
  })
  await expect(
    callTool(t, tools, sam, 'ship_order', { orgId: shop, orderId: placed.result as Id<'orders'> }),
  ).resolves.toEqual({ status: 'done', result: null })

  const asked = await callTool(t, tools, mia, 'cancel_order', { orgId: acme, orderId: order })
  expect(asked).toMatchObject({
    status: 'needs_approval',
    summary: 'Cancel the order of 2 × "Lamp".',
  })
  if (asked.status !== 'needs_approval') throw new Error('The cancel did not wait.')
  await expect(status(order)).resolves.toBe('placed')
  const ann = await signInAs(t, 'ann')
  await expect(ann.mutation(api.agents.approve, { approvalId: asked.approvalId })).resolves.toEqual(
    { status: 'approved' },
  )
  await expect(status(order)).resolves.toBe('cancelled')
})

type Setup = Awaited<ReturnType<typeof setup>>
type Who = 'ann' | 'sam' | 'duo'
/** The organization a call acts for, and the rows it names. */
type Target = {
  orgId: Id<'orgs'>
  side: 'buying' | 'selling'
  orderId: Id<'orders'>
  listingId: Id<'listings'>
}
type Actor = Awaited<ReturnType<typeof actor>>
type Call = (t: Test, actor: Actor, target: Target) => Promise<unknown>

/** The person on the web, and their agent with every scope. */
async function actor(t: Test, who: Who) {
  return { web: await signInAs(t, who), agent: await grantMcp(t, who, ['read', 'write']) }
}

const calls: Record<string, Call> = {
  'orders.list': (_t, a, { orgId, side }) => a.web.query(api.orders.list, { orgId, side }),
  'orders.place': (_t, a, { orgId, listingId }) =>
    a.web.mutation(api.orders.place, { orgId, listingId, quantity: 1 }),
  'orders.ship': (_t, a, { orgId, orderId }) => a.web.mutation(api.orders.ship, { orgId, orderId }),
  'orders.cancel': (_t, a, { orgId, orderId }) =>
    a.web.mutation(api.orders.cancel, { orgId, orderId }),
  list_orders: (t, a, { orgId, side }) =>
    callTool(t, tools, a.agent, 'list_orders', { orgId, side }),
  place_order: (t, a, { orgId, listingId }) =>
    callTool(t, tools, a.agent, 'place_order', { orgId, listingId, quantity: 1 }),
  ship_order: (t, a, { orgId, orderId }) =>
    callTool(t, tools, a.agent, 'ship_order', { orgId, orderId }),
  cancel_order: (t, a, { orgId, orderId }) =>
    callTool(t, tools, a.agent, 'cancel_order', { orgId, orderId }),
}

/** Who calls, with their own rows (the positive control) and the rows of the attack. */
const cases: Record<string, (s: Setup) => { who: Who; own: Target; attack: Target }> = {
  // Ann buys for Acme; Rival's order and draft are not hers, named for Rival or for Acme.
  "Acme at Rival's rows": (s) => ({
    who: 'ann',
    own: { orgId: s.acme, side: 'buying', orderId: s.order, listingId: s.lamp },
    attack: { orgId: s.rival, side: 'buying', orderId: s.canary, listingId: s.draft },
  }),
  "Rival's rows under Acme": (s) => ({
    who: 'ann',
    own: { orgId: s.acme, side: 'buying', orderId: s.order, listingId: s.lamp },
    attack: { orgId: s.acme, side: 'buying', orderId: s.canary, listingId: s.draft },
  }),
  // Sam sells for Shop; Bazaar's order is not his, named for Bazaar or for Shop.
  "Shop at Bazaar's order": (s) => ({
    who: 'sam',
    own: { orgId: s.shop, side: 'selling', orderId: s.order, listingId: s.lamp },
    attack: { orgId: s.bazaar, side: 'selling', orderId: s.canary, listingId: s.lamp },
  }),
  "Bazaar's order under Shop": (s) => ({
    who: 'sam',
    own: { orgId: s.shop, side: 'selling', orderId: s.order, listingId: s.lamp },
    attack: { orgId: s.shop, side: 'selling', orderId: s.canary, listingId: s.lamp },
  }),
  // Duo is in both organizations of the order: he ships it only in a call made for the seller.
  'Duo shipping for the buyer': (s) => ({
    who: 'duo',
    own: { orgId: s.shop, side: 'selling', orderId: s.order, listingId: s.lamp },
    attack: { orgId: s.acme, side: 'buying', orderId: s.order, listingId: s.lamp },
  }),
}

const code = (error: unknown) => (error as { data?: { code?: string } }).data?.code ?? error

// One row per case and call, with the one code it must fail with. A list names only an
// organization, so it has no row for another's rows named under one's own.
const rows: [string, string, string][] = [
  ["Acme at Rival's rows", 'orders.list', 'NOT_FOUND'],
  ["Acme at Rival's rows", 'orders.place', 'NOT_FOUND'],
  ["Acme at Rival's rows", 'orders.cancel', 'NOT_FOUND'],
  ["Acme at Rival's rows", 'list_orders', 'NOT_FOUND'],
  ["Acme at Rival's rows", 'place_order', 'NOT_FOUND'],
  ["Acme at Rival's rows", 'cancel_order', 'NOT_FOUND'],
  ["Rival's rows under Acme", 'orders.place', 'NOT_FOUND'],
  ["Rival's rows under Acme", 'orders.cancel', 'NOT_FOUND'],
  ["Rival's rows under Acme", 'place_order', 'NOT_FOUND'],
  ["Rival's rows under Acme", 'cancel_order', 'NOT_FOUND'],
  ["Shop at Bazaar's order", 'orders.list', 'NOT_FOUND'],
  ["Shop at Bazaar's order", 'orders.ship', 'NOT_FOUND'],
  ["Shop at Bazaar's order", 'list_orders', 'NOT_FOUND'],
  ["Shop at Bazaar's order", 'ship_order', 'NOT_FOUND'],
  ["Bazaar's order under Shop", 'orders.ship', 'NOT_FOUND'],
  ["Bazaar's order under Shop", 'ship_order', 'NOT_FOUND'],
  ['Duo shipping for the buyer', 'orders.ship', 'FORBIDDEN'],
  ['Duo shipping for the buyer', 'ship_order', 'FORBIDDEN'],
]

describe("no call reaches another organization's order or draft", () => {
  it('has a call for every tool that takes an ID', () => {
    expect(Object.keys(calls).filter((name) => name.includes('_'))).toEqual(
      tools.catalog
        .map(({ name }) => name)
        .filter((name) => !['browse_listings', 'check_approval'].includes(name)),
    )
  })

  it.each(rows)('%s: %s fails with %s', async (label, name, expected) => {
    const s = await setup()
    const { who, own, attack } = cases[label]!(s)
    const a = await actor(s.t, who)
    const state = () =>
      s.t.run(async (ctx) => ({
        orders: await ctx.db.query('orders').collect(),
        approvals: await ctx.db.query('approvals').collect(),
      }))
    const before = await state()

    await expect(calls[name]!(s.t, a, attack).then(() => 'no error', code)).resolves.toBe(expected)
    // Nothing changed: no order placed, shipped or cancelled, and no request for a person.
    await expect(state()).resolves.toEqual(before)
    // The positive control: the same call through the same path succeeds with the actor's own rows.
    await expect(calls[name]!(s.t, a, own)).resolves.toBeDefined()
  })
})
