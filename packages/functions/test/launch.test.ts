import {
  defineFunctions,
  definePolicy,
  libraryTables,
  trusted,
  unchecked,
} from '@lupinum/better-convex-functions'
import { guarded, markHousekeeping } from '@lupinum/better-convex-functions/internal'
import { launchProblems } from '@lupinum/better-convex-functions/test'
import {
  cronJobs,
  defineSchema,
  defineTable,
  internalMutationGeneric,
  makeFunctionReference,
  queryGeneric,
  type DataModelFromSchemaDefinition,
} from 'convex/server'
import { v } from 'convex/values'
import { expect, test } from 'vitest'

import { people } from './app/people'

const load = (exports: Record<string, unknown>) => async () => exports

/** An app with one table per way of holding a user ID, and every launch check passing. */
const schema = defineSchema({
  users: defineTable({ authId: v.string(), invitedBy: v.optional(v.id('users')) }).index(
    'by_auth_id',
    ['authId'],
  ),
  notes: defineTable({ authorId: v.id('users'), text: v.string() }).index('by_author', [
    'authorId',
  ]),
  teams: defineTable({
    name: v.string(),
    members: v.array(v.object({ person: v.optional(v.id('users')), role: v.string() })),
  }),
  invites: defineTable(
    v.union(
      v.object({ kind: v.literal('mail'), address: v.string() }),
      v.object({ kind: v.literal('person'), by: v.record(v.string(), v.id('users')) }),
    ),
  ),
  tags: defineTable({ label: v.string(), team: v.string() }),
  ...libraryTables,
})
type DataModel = DataModelFromSchemaDefinition<typeof schema>

const fullErasure = {
  notes: { delete: 'authorId' },
  teams: { keep: 'Teams belong to their members.' },
  invites: { keep: 'Invitations expire on their own.' },
} as const

function build({
  erasure = fullErasure as Record<string, unknown>,
  limit = true,
  raw = false,
  housekeeping = false,
  cron = false,
  query = false,
}: {
  erasure?: Record<string, unknown> | null
  limit?: boolean
  raw?: boolean
  housekeeping?: boolean
  cron?: boolean
  query?: boolean
} = {}) {
  const policy = definePolicy({
    actions: ['notes.add', 'contact.send', 'contact.read'],
    roles: { owner: ['*'] },
    scopes: { all: { label: 'Everything', actions: ['*'] } },
    public: ['contact.send', 'contact.read'],
    ...(limit && { limits: { 'contact.send': { max: 60, every: 'minute', per: 'everyone' } } }),
  })
  const fns = defineFunctions({
    auth: people<DataModel>(),
    policy,
    schema,
    user: async (ctx, authId) =>
      ctx.db
        .query('users')
        .withIndex('by_auth_id', (q) => q.eq('authId', authId))
        .unique(),
    roleOf: async () => null,
    rules: {
      users: unchecked('Test table.'),
      notes: unchecked('Test table.'),
      teams: unchecked('Test table.'),
      invites: unchecked('Test table.'),
      tags: unchecked('Test table.'),
    },
    ...(erasure && { erasure: erasure as never }),
  })
  const contact = {
    send: fns.mutation({
      action: 'contact.send',
      args: {},
      returns: v.null(),
      handler: async () => null,
    }),
    ...(query && {
      read: fns.query({
        action: 'contact.read',
        args: {},
        returns: v.null(),
        handler: async () => null,
      }),
    }),
  }
  const job = () =>
    markHousekeeping(guarded(internalMutationGeneric({ args: {}, handler: async () => null })))
  const modules = {
    './_generated/README.ts': load({}),
    './contact.ts': load(contact),
    ...(raw && {
      './admin.ts': load({ read: queryGeneric({ args: {}, handler: async () => null }) }),
    }),
    ...(housekeeping && { './agents.ts': load({ housekeeping: job() }) }),
  }
  const crons = cronJobs()
  if (cron)
    crons.hourly(
      'agent housekeeping',
      { minuteUTC: 7 },
      makeFunctionReference<'mutation', any, any>('agents:housekeeping') as never,
    )
  return { modules, schema, crons, fns }
}

const problems = (options?: Parameters<typeof build>[0]) => launchProblems(build(options))

test('a fully set up app has no launch problems', async () => {
  expect(await problems({ housekeeping: true, cron: true, query: true })).toEqual([])
})

test('it throws when the module map checks nothing', async () => {
  await expect(launchProblems({ ...build(), modules: {} })).rejects.toThrow(/found no modules/)
})

// Catches: a raw Convex function (no policy, no row rules) reaching production.
test('check 1: a function built with Convex builders is named, with the fix', async () => {
  expect(await problems({ raw: true })).toEqual([
    expect.stringMatching(/^\.\/admin\.ts:read is built with Convex's own builders.*trusted\(/),
  ])
  const trustedOne = build({ raw: true })
  trustedOne.modules['./admin.ts'] = load({
    read: trusted('Health check.', queryGeneric({ args: {}, handler: async () => null })),
  })
  expect(await launchProblems(trustedOne)).toEqual([])
})

// Catches: deleting an account that leaves user IDs behind (nested, optional, in a union or a record).
test('check 2: tables with a user ID that are not in erasure are named with their field', async () => {
  expect(await problems({ erasure: { notes: { delete: 'authorId' } } })).toEqual([
    expect.stringContaining(
      "The table teams holds a user ID in members[].person but is not in erasure. Add teams: { delete: 'members[].person' }",
    ),
    expect.stringContaining('The table invites holds a user ID in by[] but is not in erasure.'),
  ])
})

// Catches: shipping without account deletion at all, when the schema stores user IDs.
test('check 2: no erasure at all says account deletion is not set up', async () => {
  expect(await problems({ erasure: null })).toEqual([
    expect.stringMatching(
      /^Account deletion is not set up: add `erasure`.*notes, teams, invites\./,
    ),
  ])
})

// Catches: the users table or a library table being demanded in the map (the library erases those).
test('check 2: the users table and the library tables need no entry', async () => {
  // `users.invitedBy` holds a user ID, and approvals/activity hold user IDs in the library tables.
  expect(await problems()).toEqual([])
})

// Catches: housekeeping nobody schedules, so requests never expire and old activity piles up.
test('check 3: the agents housekeeping function needs a cron', async () => {
  expect(await problems({ housekeeping: true })).toEqual([
    expect.stringMatching(
      /^\.\/agents\.ts exports housekeeping.*no cron calls it\. Add crons\.hourly\(.*internal\.agents\.housekeeping/,
    ),
  ])
  expect(await problems({ housekeeping: true, cron: true })).toEqual([])
})

// Catches: a public mutation anyone can call in a loop.
test('check 4: a public mutation without a limit is named, with the limit to add', async () => {
  expect(await problems({ limit: false, query: true })).toEqual([
    expect.stringMatching(
      /^\.\/contact\.ts:send is a public mutation \(action contact\.send\) with no limit.*limits: \{ 'contact\.send'/,
    ),
  ])
})
