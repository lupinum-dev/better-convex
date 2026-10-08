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
  shares: defineTable({
    owner: v.id('users'),
    reviewer: v.optional(v.id('users')),
  })
    .index('by_owner', ['owner'])
    .index('by_reviewer', ['reviewer']),
  scores: defineTable({ byPerson: v.record(v.id('users'), v.number()) }),
  tags: defineTable({ label: v.string(), team: v.string() }),
  ...libraryTables,
})
type DataModel = DataModelFromSchemaDefinition<typeof schema>

const fullErasure = {
  notes: { delete: 'authorId' },
  teams: { keep: 'Teams belong to their members.' },
  invites: { keep: 'Invitations expire on their own.' },
  shares: [{ delete: 'owner' }, { anonymize: 'reviewer' }],
  scores: { keep: 'Scores are shown without names.' },
} as const

function build({
  erasure = fullErasure as Record<string, unknown>,
  limit = true,
  raw = false,
  housekeeping = false,
  cron = false,
  query = false,
  step = true,
}: {
  erasure?: Record<string, unknown> | null
  limit?: boolean
  raw?: boolean
  housekeeping?: boolean
  cron?: boolean
  query?: boolean
  step?: boolean
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
      shares: unchecked('Test table.'),
      scores: unchecked('Test table.'),
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
  const modules: Record<string, () => Promise<unknown>> = {
    './_generated/README.ts': load({}),
    './contact.ts': load(contact),
    ...(raw && {
      './admin.ts': load({ read: queryGeneric({ args: {}, handler: async () => null }) }),
    }),
    ...(step &&
      erasure && { './erasure.ts': load({ eraseStep: (fns as any).erasure?.eraseStep }) }),
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
  expect(await problems({ erasure: { notes: fullErasure.notes } })).toEqual([
    expect.stringContaining(
      "The table teams holds a user ID in members[].person but erasure does not cover it. Add { delete: 'members' }",
    ),
    expect.stringContaining(
      'The table invites holds a user ID in by[] but erasure does not cover it.',
    ),
    expect.stringContaining('The table shares holds a user ID in owner but'),
    expect.stringContaining('The table shares holds a user ID in reviewer but'),
    expect.stringContaining('The table scores holds a user ID in byPerson but'),
  ])
})

// Catches: an entry for one field hiding a second user ID field of the same table.
test('check 2: a table is checked field by field, and keep covers all of it', async () => {
  expect(await problems({ erasure: { ...fullErasure, shares: { delete: 'owner' } } })).toEqual([
    expect.stringMatching(
      /^The table shares holds a user ID in reviewer but erasure does not cover it\. Add \{ delete: 'reviewer' \}.*an array holds one entry per field/,
    ),
  ])
  expect(
    await problems({ erasure: { ...fullErasure, shares: { keep: 'Shares are public.' } } }),
  ).toEqual([])
})

// Catches: a user ID used as the key of a record staying behind unnoticed.
test('check 2: a user ID as a record key counts', async () => {
  const { scores: _scores, ...without } = fullErasure
  expect(await problems({ erasure: without })).toEqual([
    expect.stringContaining('The table scores holds a user ID in byPerson but'),
  ])
})

// Catches: an erasure map that is never run, because no module exports the step.
test('check 2: erasure without an exported eraseStep is named, with the fix', async () => {
  expect(await problems({ step: false })).toEqual([
    'Account deletion is set up but no module exports fns.erasure.eraseStep: add `export const { eraseStep } = fns.erasure` in convex/erasure.ts.',
  ])
})

// Catches: shipping without account deletion at all, when the schema stores user IDs.
test('check 2: no erasure at all says account deletion is not set up', async () => {
  expect(await problems({ erasure: null })).toEqual([
    expect.stringMatching(
      /^Account deletion is not set up: add `erasure`.*notes, teams, invites, shares, scores\./,
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

// Catches: a launch check that passes for the wrong reason. Every row changes the valid app in one
// place and must name exactly that problem, in these words; undoing the change must empty the list,
// so a check that always complains, or never does, fails the table.
const valid = { housekeeping: true, cron: true, query: true } as const
const { notes, teams, invites, shares, scores } = fullErasure
test.each([
  [
    'a raw function',
    { raw: true },
    [
      "./admin.ts:read is built with Convex's own builders, so it skips the policy and the row rules. Build it with fns.query, fns.mutation or fns.internalMutation, or mark it trusted('why', fn).",
    ],
  ],
  [
    'a user ID field with no erasure entry',
    { erasure: { teams, invites, shares, scores } },
    [
      "The table notes holds a user ID in authorId but erasure does not cover it. Add { delete: 'authorId' }, { anonymize: 'authorId' } or { keep: 'why the rows stay' } to the notes entry of erasure in defineFunctions (an array holds one entry per field).",
    ],
  ],
  [
    'a second user ID field of a table',
    { erasure: { notes, teams, invites, shares: { delete: 'owner' }, scores } },
    [
      "The table shares holds a user ID in reviewer but erasure does not cover it. Add { delete: 'reviewer' }, { anonymize: 'reviewer' } or { keep: 'why the rows stay' } to the shares entry of erasure in defineFunctions (an array holds one entry per field).",
    ],
  ],
  [
    'a user ID as a record key',
    { erasure: { notes, teams, invites, shares } },
    [
      "The table scores holds a user ID in byPerson but erasure does not cover it. Add { delete: 'byPerson' }, { anonymize: 'byPerson' } or { keep: 'why the rows stay' } to the scores entry of erasure in defineFunctions (an array holds one entry per field).",
    ],
  ],
  [
    'a user ID in a nested array field',
    { erasure: { notes, invites, shares, scores } },
    [
      "The table teams holds a user ID in members[].person but erasure does not cover it. Add { delete: 'members' }, { anonymize: 'members' } or { keep: 'why the rows stay' } to the teams entry of erasure in defineFunctions (an array holds one entry per field).",
    ],
  ],
  [
    'no eraseStep export',
    { step: false },
    [
      'Account deletion is set up but no module exports fns.erasure.eraseStep: add `export const { eraseStep } = fns.erasure` in convex/erasure.ts.',
    ],
  ],
  [
    'no erasure at all',
    { erasure: null },
    [
      'Account deletion is not set up: add `erasure` and `schema` to defineFunctions, with an entry for notes, teams, invites, shares, scores. Each table holds a user ID, so it would stay behind when a person deletes their account.',
    ],
  ],
  [
    'housekeeping that no cron calls',
    { cron: false },
    [
      "./agents.ts exports housekeeping, which expires agent requests and deletes old activity, but no cron calls it. Add crons.hourly('agent housekeeping', { minuteUTC: 7 }, internal.agents.housekeeping, {}) to convex/crons.ts.",
    ],
  ],
  [
    'a public mutation without a limit',
    { limit: false },
    [
      "./contact.ts:send is a public mutation (action contact.send) with no limit, so one visitor can fill your database. Add limits: { 'contact.send': { max: 60, every: 'minute', per: 'everyone' } } to definePolicy.",
    ],
  ],
] as const)(
  'launch variant: %s is named, and undoing it clears the list',
  async (_name, change, expected) => {
    expect(await problems(valid)).toEqual([])
    expect(await problems({ ...valid, ...change } as never)).toEqual(expected)
    expect(await problems(valid)).toEqual([])
  },
)

// Catches: a module map that does not match what Convex deploys (rel-h). A raw function in a nested
// `_generated` folder is deployed, so it is named; the one in the root `_generated` folder is not.
test.each([
  [
    'a nested _generated folder',
    './legacy/_generated/leak.ts',
    [
      "./legacy/_generated/leak.ts:read is built with Convex's own builders, so it skips the policy and the row rules. Build it with fns.query, fns.mutation or fns.internalMutation, or mark it trusted('why', fn).",
    ],
  ],
  ['the root _generated folder', './_generated/leak.ts', []],
  ['a test file', './leak.test.ts', []],
] as const)('launch variant: a raw function in %s', async (_name, path, expected) => {
  const app = build(valid)
  expect(await launchProblems(app)).toEqual([])
  app.modules[path] = load({ read: queryGeneric({ args: {}, handler: async () => null }) })
  expect(await launchProblems(app)).toEqual(expected)
  Reflect.deleteProperty(app.modules, path)
  expect(await launchProblems(app)).toEqual([])
})
