import {
  defineFunctions,
  definePolicy,
  eraseUser,
  unchecked,
} from '@lupinum/better-convex-functions'
import { convexTest } from 'convex-test'
import { defineSchema, defineTable, makeFunctionReference } from 'convex/server'
import { v } from 'convex/values'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { people } from './app/people'
import schema from './erasure/schema'

const modules = import.meta.glob(['./erasure/*.ts', './erasure/_generated/*.ts'])
const step = makeFunctionReference<'mutation', any, any>('fns:eraseStep') as never
const eraseStep = makeFunctionReference<'mutation', any, any>('fns:eraseStep')

// Real limits: a step reads 100 rows (packages/functions/src/budget.ts), so 250 rows need three.
const many = 250

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

async function setup() {
  const t = convexTest({ schema, modules, transactionLimits: true })
  const ids = await t.run(async (ctx) => {
    const ann = await ctx.db.insert('users', { authId: 'ann' })
    const bob = await ctx.db.insert('users', { authId: 'bob' })
    return { ann, bob }
  })
  return { t, ...ids }
}

async function erase(t: Awaited<ReturnType<typeof setup>>['t'], userId: string) {
  await t.run((ctx) => eraseUser(ctx, userId as never, step))
  await t.finishAllScheduledFunctions(vi.runAllTimers)
}

// Catches: erasure that stops after one batch, touches another person's rows, or ignores the map.
test('erasure deletes, anonymizes and keeps across batches, and leaves other people alone', async () => {
  const { t, ann, bob } = await setup()
  await t.run(async (ctx) => {
    for (let i = 0; i < many; i++) {
      await ctx.db.insert('drafts', { authorId: ann, text: `a${i}` })
      await ctx.db.insert('comments', { authorId: ann, body: `a${i}` })
    }
    await ctx.db.insert('drafts', { authorId: bob, text: 'b' })
    await ctx.db.insert('comments', { authorId: bob, body: 'b' })
    await ctx.db.insert('projects', { ownerId: ann, name: 'Team' })
  })
  await erase(t, ann)
  const after = await t.run(async (ctx) => ({
    drafts: await ctx.db.query('drafts').collect(),
    comments: await ctx.db.query('comments').collect(),
    projects: await ctx.db.query('projects').collect(),
    steps: (await ctx.db.system.query('_scheduled_functions').collect()).length,
  }))
  expect(after.drafts.map((row) => [row.authorId, row.text])).toEqual([[bob, 'b']])
  expect(after.comments).toHaveLength(many + 1)
  expect(after.comments.filter((row) => row.authorId === undefined)).toHaveLength(many)
  expect(after.comments.filter((row) => row.authorId === bob)).toHaveLength(1)
  expect(after.projects.map((row) => [row.ownerId, row.name])).toEqual([[ann, 'Team']])
  // Three batches for the drafts, three for the comments, one more to see nothing is left.
  expect(after.steps).toBeGreaterThan(3)
})

// Catches: a table with two user ID fields erasing only one of them.
test('an array of entries erases every field of a table', async () => {
  const { t, ann, bob } = await setup()
  await t.run(async (ctx) => {
    await ctx.db.insert('tasks', { authorId: ann, assigneeId: bob })
    await ctx.db.insert('tasks', { authorId: bob, assigneeId: ann })
    await ctx.db.insert('tasks', { authorId: bob, assigneeId: bob })
  })
  await erase(t, ann)
  const tasks = await t.run((ctx) => ctx.db.query('tasks').collect())
  expect(tasks.map((row) => [row.authorId, row.assigneeId])).toEqual([
    [bob, undefined],
    [bob, bob],
  ])
})

// Catches: a person with many runs never finishing, because the run query used up the budget
// and no messages were deleted.
test('a person with many runs and messages is erased in a bounded number of steps', async () => {
  const { t, ann, bob } = await setup()
  await t.run(async (ctx) => {
    const grant = await ctx.db.insert('agentGrants', {
      authId: 'bob',
      userId: bob,
      agent: 'helper',
      scopes: [],
      expiresAt: 1,
    })
    for (let i = 0; i < 120; i++) {
      const id = await ctx.db.insert('agentRuns', { ...run(ann), grantId: grant })
      for (let order = 0; order < 4; order++)
        await ctx.db.insert('agentMessages', { runId: id, order, json: '{}' })
    }
    const bobRun = await ctx.db.insert('agentRuns', { ...run(bob), grantId: grant })
    await ctx.db.insert('agentMessages', { runId: bobRun, order: 0, json: '{}' })
  })
  await erase(t, ann)
  const after = await t.run(async (ctx) => ({
    runs: await ctx.db.query('agentRuns').collect(),
    messages: await ctx.db.query('agentMessages').collect(),
    steps: (await ctx.db.system.query('_scheduled_functions').collect()).length,
  }))
  expect(after.runs.map((row) => row.userId)).toEqual([bob])
  expect(after.messages).toHaveLength(1)
  // 600 rows to read at 100 a step is six steps; the bound leaves room for the end of each step.
  expect(after.steps).toBeLessThan(12)
})

// Catches: a second run (a retry, or a person erased twice) failing or touching more rows.
test('running a step twice is safe', async () => {
  const { t, ann, bob } = await setup()
  await t.run(async (ctx) => {
    await ctx.db.insert('drafts', { authorId: ann, text: 'a' })
    await ctx.db.insert('drafts', { authorId: bob, text: 'b' })
  })
  await t.mutation(eraseStep, { userId: ann, self: 'fns:eraseStep' })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  await t.mutation(eraseStep, { userId: ann, self: 'fns:eraseStep' })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const drafts = await t.run((ctx) => ctx.db.query('drafts').collect())
  expect(drafts.map((row) => row.text)).toEqual(['b'])
})

const run = (userId: string, agent = 'helper') => ({
  grantId: undefined as never,
  userId,
  agent,
  step: 'x:step',
  task: 'task',
  status: 'done' as const,
  turn: 1,
  steps: 1,
  stepAt: 0,
})
const person = (userId: string) => ({
  key: `person:${userId}`,
  kind: 'person' as const,
  door: 'web' as const,
  userId,
})
const approval = (requester: ReturnType<typeof person>, status: 'pending' | 'approved') => ({
  action: 'drafts.read',
  tool: 'read',
  input: {},
  summary: 's',
  requester,
  caller: { door: 'app' as const, runId: 'r' },
  status,
  expiresAt: Date.now() + 1000,
})

// Catches: library tables keeping the person's ID, or erasure removing other people's rows.
test('library tables: own rows go or lose the ID, other people keep theirs', async () => {
  const { t, ann, bob } = await setup()
  await t.run(async (ctx) => {
    await ctx.db.insert('activity', {
      actor: person(ann),
      action: 'drafts.read',
      status: 'done',
      decidedBy: bob,
    })
    await ctx.db.insert('activity', { actor: person(bob), action: 'drafts.read', status: 'done' })
    await ctx.db.insert('approvals', approval(person(ann), 'pending'))
    // Decided by someone else: the row stays, only the requester loses the ID.
    await ctx.db.insert('approvals', { ...approval(person(ann), 'approved'), decidedBy: bob })
    await ctx.db.insert('approvals', { ...approval(person(bob), 'pending') })
    // An agent's request carries the person's user, session and grant IDs in `caller`.
    await ctx.db.insert('approvals', {
      ...approval(person(ann), 'approved'),
      caller: {
        door: 'mcp',
        principal: {
          kind: 'oauth',
          userId: ann,
          clientId: 'client',
          scopes: [],
          sessionId: 'session-ann',
          grantId: 'grant-ann',
          issuer: 'https://issuer.test',
          resource: 'https://issuer.test/mcp',
          expiresAt: 1,
        },
      },
    })
    const annGrant = await ctx.db.insert('agentGrants', {
      authId: 'ann',
      userId: ann,
      agent: 'helper',
      scopes: [],
      expiresAt: 1,
    })
    const bobGrant = await ctx.db.insert('agentGrants', {
      authId: 'bob',
      userId: bob,
      agent: 'helper',
      scopes: [],
      expiresAt: 1,
    })
    const annRun = await ctx.db.insert('agentRuns', { ...run(ann), grantId: annGrant })
    const bobRun = await ctx.db.insert('agentRuns', { ...run(bob), grantId: bobGrant })
    for (let i = 0; i < many; i++)
      await ctx.db.insert('agentMessages', { runId: annRun, order: i, json: '{}' })
    await ctx.db.insert('agentMessages', { runId: bobRun, order: 0, json: '{}' })
    // A person's limit bucket and an agent's bucket go; a tenant bucket and other people's stay.
    for (const key of [
      `person:${ann}|limit:projects.create`,
      `mcp:${ann}:client|writes`,
      `app:${ann}:helper|writes`,
      `tenant:org1|limit:reports.generate`,
      `person:${bob}|limit:projects.create`,
      `everyone|limit:contact.send`,
    ])
      await ctx.db.insert('rateLimits', { key, tokens: 1, at: 1 })
  })
  await erase(t, ann)
  const after = await t.run(async (ctx) => ({
    activity: await ctx.db.query('activity').collect(),
    approvals: await ctx.db.query('approvals').collect(),
    grants: await ctx.db.query('agentGrants').collect(),
    runs: await ctx.db.query('agentRuns').collect(),
    messages: await ctx.db.query('agentMessages').collect(),
    limits: await ctx.db.query('rateLimits').collect(),
  }))
  expect(after.activity.map((row) => row.actor.userId)).toEqual([undefined, bob])
  expect(JSON.stringify(after.activity)).not.toContain(ann)
  expect(after.approvals.map((row) => [row.requester.userId, row.status, row.decidedBy])).toEqual([
    [undefined, 'cancelled', undefined],
    [undefined, 'approved', bob],
    [bob, 'pending', undefined],
    [undefined, 'approved', undefined],
  ])
  // The person's request keeps no ID of theirs in `caller`; the other person's request keeps its caller.
  expect(JSON.stringify(after.approvals.map((row) => row.caller))).not.toMatch(
    /ann|grant-|session-/,
  )
  expect(after.approvals[2]?.caller).toEqual({ door: 'app', runId: 'r' })
  expect(JSON.stringify(after.approvals.map((row) => row.requester))).not.toContain(ann)
  expect(after.grants.map((row) => row.userId)).toEqual([bob])
  expect(after.runs.map((row) => row.userId)).toEqual([bob])
  expect(after.messages).toHaveLength(1)
  expect(after.limits.map((row) => row.key).sort()).toEqual([
    'everyone|limit:contact.send',
    `person:${bob}|limit:projects.create`,
    'tenant:org1|limit:reports.generate',
  ])
})

// Catches: an app that never configured erasure getting erasure code.
test('without erasure there is no erasure code', () => {
  const plain = defineFunctions({
    auth: people<any>(),
    policy: definePolicy({
      actions: ['x.read'],
      roles: { owner: ['*'] },
      scopes: { all: { label: 'Everything', actions: ['*'] } },
    }),
    user: async () => null,
    roleOf: async () => null,
    rules: {},
  })
  expect('erasure' in plain).toBe(false)
})

const base = defineSchema({
  users: defineTable({ authId: v.string() }),
  notes: defineTable({
    authorId: v.id('users'),
    editorId: v.id('users'),
    body: v.optional(v.string()),
  }).index('by_author', ['authorId']),
})
const define = (erasure: object, schema: object | null = base) =>
  defineFunctions({
    auth: people<any>(),
    policy: definePolicy({
      actions: ['x.read'],
      roles: { owner: ['*'] },
      scopes: { all: { label: 'Everything', actions: ['*'] } },
    }),
    user: async () => null,
    roleOf: async () => null,
    rules: { users: unchecked('t'), notes: unchecked('t') } as never,
    erasure: erasure as never,
    schema: (schema ?? undefined) as never,
  })

// Catches: a map the schema cannot carry out failing later, in a scheduled step, instead of at definition.
test.each([
  [
    { notes: { delete: 'editorId' } },
    /Erasure for "notes": add an index whose first field is "editorId"/,
  ],
  [
    { notes: { anonymize: 'authorId' } },
    /Erasure for "notes": anonymize removes "authorId", so the schema must say v.optional/,
  ],
  [{ notes: { keep: ' ' } }, /Erasure for "notes": keep needs a reason/],
  [{ notes: { delete: 'authorId', keep: 'both' } }, /use exactly one of delete, anonymize or keep/],
  [
    { notes: [{ delete: 'authorId' }, { keep: 'why' }] },
    /keep covers the whole table and cannot be combined with other entries/,
  ],
  [
    { notes: [{ delete: 'authorId' }, { delete: 'editorId' }] },
    /Erasure for "notes": add an index whose first field is "editorId"/,
  ],
  [
    { notes: [{ delete: 'authorId' }, { anonymize: 'authorId' }] },
    /anonymize removes "authorId", so the schema must say v.optional/,
  ],
  [{ notes: [] }, /the list of entries is empty/],
  [{ notes: { delete: 'missing' } }, /the table has no field "missing"/],
  [{ posts: { delete: 'authorId' } }, /Erasure for "posts": the schema has no such table/],
  [{ activity: { delete: 'actor' } }, /Erasure for "activity": the library erases its own tables/],
])('erasure definition error: %j', (erasure, message) => {
  expect(() => define(erasure)).toThrow(message)
})

test('erasure needs the schema', () => {
  expect(() => define({ notes: { keep: 'why' } }, null)).toThrow(/Erasure needs the app schema/)
})
