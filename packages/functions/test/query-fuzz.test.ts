import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { expect, test } from 'vitest'

import { runSeededAuthCorpus, type SeededRandom } from '../../../test/auth-fuzz/seeded'
import { runChain, type Chain } from './rules/chain'
import schema from './rules/schema'

// T4: random query chains through the rules, against the same chain on the raw db. Catches a
// rewrite of the query proxy that checks the wrong rows, or drifts from what Convex returns, in a
// combination that the one-example-per-method table in rules.test.ts does not cover.
//
// The oracle is Convex plus one comparison: a row is foreign when its orgId is not the actor's org.
// If the raw chain hands out a foreign row, the guarded chain must throw (rows are checked, not
// filtered); otherwise it must return exactly what the raw chain returns.

const modules = import.meta.glob(['./rules/*.ts', './rules/_generated/*.ts'])
const run = makeFunctionReference<'query'>('chain:run')
const projectName = makeFunctionReference<'query'>('ops:projectName')

/** Three orgs with one member each, and twelve projects spread over them at random. */
async function setup(random: SeededRandom) {
  const t = convexTest(schema, modules)
  const { orgs, projects } = await t.run(async (ctx) => {
    const orgs: Record<string, string> = {}
    for (const [authId, role] of [
      ['ann', 'owner'],
      ['bob', 'owner'],
      ['cyd', 'viewer'],
    ] as const) {
      const userId = await ctx.db.insert('users', { authId })
      const orgId = await ctx.db.insert('orgs', { name: authId })
      await ctx.db.insert('memberships', { orgId, userId, role })
      orgs[authId] = orgId
    }
    const projects = []
    for (let i = 0; i < 12; i++) {
      const orgId = random.pick(Object.values(orgs)) as never
      const archived = random.integer(2) === 1
      projects.push(await ctx.db.insert('projects', { orgId, name: `p${i}`, archived }))
    }
    return { orgs, projects }
  })
  return { t, orgs, projects }
}

function randomChain(random: SeededRandom, orgIds: string[]): Chain {
  const filterField = random.pick(['orgId', 'archived'] as const)
  return {
    source: random.pick([{ orgId: random.pick(orgIds) }, 'fullTableScan', 'table'] as const),
    order: random.pick(['asc', 'desc', null] as const),
    filter:
      random.integer(2) === 0
        ? null
        : {
            field: filterField,
            value: filterField === 'orgId' ? random.pick(orgIds) : random.integer(2) === 1,
            beforeOrder: random.integer(2) === 1,
          },
    read: random.pick([
      { how: 'collect' },
      { how: 'first' },
      { how: 'unique' },
      { how: 'take', n: random.integer(5) },
      { how: 'paginate', numItems: 1 + random.integer(4), cursor: null },
      { how: 'forAwait', stopAfter: 1 + random.integer(5) },
    ] as const),
  }
}

/** The rows a read hands out. */
function rowsOf(result: unknown): { orgId: string }[] {
  if (result === null) return []
  if (Array.isArray(result)) return result
  if (typeof result === 'object' && 'page' in result) return (result as { page: [] }).page
  return [result as { orgId: string }]
}

test('a random query chain hands out exactly the raw rows, or fails on a foreign one', async () => {
  let world: Awaited<ReturnType<typeof setup>> | undefined
  await runSeededAuthCorpus(
    'functions-query-chains',
    100,
    async (random, caseIndex) => {
      if (caseIndex === 0) world = await setup(random)
      const { t, orgs, projects } = world!
      const authId = random.pick(['ann', 'bob', 'cyd'])
      const actor = t.withIdentity({ subject: authId })
      const chain = randomChain(random, Object.values(orgs))
      // A paginated chain follows its cursor, one page per call, as a client does.
      for (let page = 0; page < 13; page++) {
        const raw = await t
          .run((ctx) => runChain(ctx.db, chain))
          .then(
            (value) => ({ value }),
            (error: Error) => ({ error }),
          )
        const guarded = actor.query(run, { chain })
        if ('error' in raw) {
          // unique() over two rows: Convex fails, and so must the guarded chain.
          await expect(guarded).rejects.toThrow(/more than one|may not read/)
          break
        }
        if (rowsOf(raw.value).some((row) => row.orgId !== orgs[authId])) {
          await expect(guarded).rejects.toThrow(/may not read/)
          break
        }
        expect(await guarded).toEqual(raw.value)
        const result = raw.value as { isDone?: boolean; continueCursor?: string }
        if (chain.read.how !== 'paginate' || result.isDone) break
        chain.read.cursor = result.continueCursor!
      }
      // db.get of a foreign ID returns null, as for a missing one.
      const id = random.pick(projects)
      const row = await t.run((ctx) => ctx.db.get(id as never))
      expect(await actor.query(projectName, { id })).toBe(
        (row as { orgId: string }).orgId === orgs[authId] ? (row as { name: string }).name : null,
      )
    },
    'functions',
  )
})
