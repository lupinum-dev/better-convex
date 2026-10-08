import {
  allOf,
  anyOf,
  custom,
  defineFunctions,
  definePolicy,
  owner,
  publicRead,
  tenant,
} from '@lupinum/better-convex-functions'
import { createBetterConvexAuth } from '@lupinum/better-convex-nuxt/better-auth/server'
import type { DataModelFromSchemaDefinition } from 'convex/server'

import { betterAuthComponent } from '../support'
import type schema from './schema'

// What the library hands each app callback, and what it does with what a callback returns.
// convex-test runs the functions in the test's own process, so a callback records what it got in
// `seen`, which the test reads.

type DataModel = DataModelFromSchemaDefinition<typeof schema>

/** Values a decision callback may return at runtime, outside its type, by the name a row stores. */
export const bad = {
  undefined: () => undefined,
  null: () => null,
  "'ALLOW'": () => 'ALLOW',
  "'allow '": () => 'allow ',
  '1': () => 1,
  '{}': () => ({}),
  'a Promise of undefined': () => Promise.resolve(undefined),
  'a thrown Error': () => {
    throw new Error('The app callback broke.')
  },
} as const
export type Bad = keyof typeof bad

/** `bad:<name>` stands for that value of `bad`; anything else is itself. */
function stored(value: string): unknown {
  return value.startsWith('bad:') ? bad[value.slice(4) as Bad]() : value
}

const keys = (value: unknown) =>
  value && typeof value === 'object' ? Object.keys(value).sort() : value

/** The keys of a context, its `db` and its actor, and of the actor's caller and principal. */
export function snapshot(ctx: Record<string, any>) {
  const actor = ctx.actor as Record<string, any> | undefined
  return {
    ctx: keys(ctx),
    db: keys(ctx.db),
    ...(actor && { actor: keys(actor) }),
    ...(actor?.caller && { caller: keys(actor.caller) }),
    ...(actor?.caller?.principal && { principal: keys(actor.caller.principal) }),
  }
}

/** What each callback point last received. */
export const seen = new Map<string, unknown>()

export const policy = definePolicy({
  actions: ['probe.read', 'probe.edit', 'probe.public', 'probe.ask', 'probe.rule'],
  roles: { owner: ['*'] },
  scopes: { all: { label: 'Everything.', actions: ['*'] } },
  public: ['probe.public'],
  agents: {
    'probe.ask': 'approve',
    'probe.rule': (...args) => {
      seen.set('agent rule', { arguments: args.length, input: keys(args[0]) })
      return 'allow'
    },
  },
  approvers: { 'probe.ask': ['owner'] },
})

/** The real Better Auth component, registered in the test's setup. */
export const auth = createBetterConvexAuth<DataModel>(betterAuthComponent, {})

/** A custom rule that records its context and returns what the row's `verdict` names. */
const verdict = (point: string) =>
  custom<{ verdict: string }>((ctx, row) => {
    seen.set(point, snapshot(ctx))
    return (row.verdict === 'true' ? true : stored(row.verdict)) as boolean
  })

export const fns = defineFunctions({
  auth,
  policy,
  user: async (ctx, authId) => {
    seen.set('user', snapshot(ctx))
    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authId))
      .unique()
    return user?.active ? user : null
  },
  roleOf: async (ctx, user, tenant) => {
    seen.set('roleOf', { ...snapshot(ctx), user: keys(user), tenant: keys(tenant) })
    if (tenant.table !== 'orgs') return null
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_org_user', (q) => q.eq('orgId', tenant.id).eq('userId', user._id))
      .unique()
    return membership ? (stored(membership.role) as 'owner') : null
  },
  rules: {
    users: owner('_id'),
    orgs: tenant('_id'),
    memberships: owner('userId'),
    checked: verdict('custom rule'),
    eitherChecked: anyOf(owner('ownerId'), verdict('custom rule in anyOf')),
    bothChecked: allOf(tenant('orgId'), verdict('custom rule in allOf')),
    publicChecked: publicRead<{ verdict: string }>(
      (row) => (row.verdict === 'true' ? true : stored(row.verdict)) as boolean,
    ),
  },
})

export const { query, mutation, internalQuery, internalMutation, internalAction, job } = fns
