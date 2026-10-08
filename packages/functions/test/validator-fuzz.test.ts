import { convexTest } from 'convex-test'
import { makeFunctionReference, queryGeneric } from 'convex/server'
import { convexToJson, jsonToConvex, v, type GenericValidator, type Value } from 'convex/values'
import { expect, test } from 'vitest'

import { runSeededAuthCorpus, type SeededRandom } from '../../../test/auth-fuzz/seeded'
import { matches, type ValidatorJson } from '../src/values'
import { query } from './rules/fns'
import schema from './rules/schema'

// T5: random validators and values (matching and near-miss), against Convex's own validation. Two
// questions per case: does `matches()` agree with Convex about which union members a value is
// (tenant discovery trusts it), and does a defineFunctions operation over that argument work for
// every value Convex accepts, and refuse a value that names another tenant's project.
//
// Oracle: convex-test runs the validator as a real function argument, so Convex's check decides.
// convex-test cannot decide two things: literals of bigint or non-finite/negative-zero floats (it
// compares the value with the encoded literal `{ $integer }`/`{ $float }`, so it rejects every
// value), and records (its validator has no record case, so it accepts every value). Where it
// cannot decide, `matches()` is compared with the reference below, which compares `convexToJson`
// encodings as the Convex backend does; the reference itself is checked against convex-test on
// every case it can decide. The operation call needs convex-test to accept the argument, so it
// skips only cases with such a literal.

const modules = import.meta.glob(['./rules/*.ts', './rules/_generated/*.ts'])
const CASES_PER_SEED = 50 // x 4 reviewed seeds = 200 cases
const compiled = new Map<number, Record<string, unknown>>()
const fn = (index: number, name: string) => makeFunctionReference<'query'>(`g${index}:${name}`)

const t = convexTest(schema, {
  ...modules,
  ...Object.fromEntries(
    Array.from({ length: 4 * CASES_PER_SEED }, (_, i) => [
      `./rules/g${i}.ts`,
      async () => compiled.get(i)!,
    ]),
  ),
})

let world: Awaited<ReturnType<typeof setup>> | undefined
async function setup() {
  const ids = await t.run(async (ctx) => {
    const ann = await ctx.db.insert('users', { authId: 'ann' })
    const orgA = await ctx.db.insert('orgs', { name: 'A' })
    const orgB = await ctx.db.insert('orgs', { name: 'B' })
    await ctx.db.insert('memberships', { orgId: orgA, userId: ann, role: 'owner' })
    return {
      own: await ctx.db.insert('projects', { orgId: orgA, name: 'own', archived: false }),
      foreign: await ctx.db.insert('projects', { orgId: orgB, name: 'foreign', archived: false }),
      note: await ctx.db.insert('notes', { userId: ann, text: 'n' }),
      file: await ctx.storage.store(new Blob(['x'])),
    }
  })
  const tables = new Map<string, string>([
    [ids.own, 'projects'],
    [ids.foreign, 'projects'],
    [ids.note, 'notes'],
    [ids.file, '_storage'],
  ])
  return { ...ids, tables, ann: t.withIdentity({ subject: 'ann' }) }
}

// ---- generators ----

const LITERALS: (string | number | boolean | bigint)[] = [
  'a',
  'b',
  1,
  0,
  1.5,
  true,
  false,
  1n,
  2n,
  Number.NaN,
  Infinity,
  -Infinity,
  -0,
]
/** Literals convex-test cannot validate: bigint, non-finite floats and negative zero. */
const isExotic = (literal: unknown) =>
  typeof literal === 'bigint' ||
  (typeof literal === 'number' && (!Number.isFinite(literal) || Object.is(literal, -0)))

function genValidator(random: SeededRandom, depth: number): GenericValidator {
  const leaves = [
    () => v.null(),
    () => v.string(),
    () => v.number(),
    () => v.boolean(),
    () => v.int64(),
    () => v.bytes(),
    () => v.any(),
    () => v.id('projects'),
    () => v.id('_storage'),
    () => v.id('notes'),
    () => v.literal(random.pick(LITERALS)),
  ]
  if (depth >= 3 || random.integer(3) === 0) return random.pick(leaves)()
  const child = () => genValidator(random, depth + 1)
  switch (random.integer(4)) {
    case 0:
      return v.array(child())
    case 1:
      return v.record(v.string(), child())
    case 2:
      return v.object(
        Object.fromEntries(
          ['a', 'b', 'c'].slice(0, 1 + random.integer(3)).map((key) => {
            const field = child()
            return [key, random.integer(3) === 0 ? v.optional(field) : field]
          }),
        ),
      )
    default: {
      const members = Array.from({ length: 2 + random.integer(2) }, child)
      return v.union(...(members as [GenericValidator, GenericValidator]))
    }
  }
}

function genValue(random: SeededRandom, json: ValidatorJson, mutate: boolean): unknown {
  const { own, foreign, note, file } = world!
  // A near miss: somewhere in the value, something of the wrong kind.
  if (mutate && random.integer(6) === 0)
    return random.pick([
      null,
      'zz',
      7,
      7n,
      true,
      [],
      {},
      new ArrayBuffer(1),
      own,
      foreign,
      note,
      file,
    ])
  switch (json.type) {
    case 'null':
      return null
    case 'number':
      return random.pick([0, 1.5, -2, Number.NaN, Infinity])
    case 'bigint':
      return random.pick([0n, 5n, -7n])
    case 'boolean':
      return random.integer(2) === 1
    case 'string':
      return random.pick(['', 'a', 'x y'])
    case 'bytes':
      return new ArrayBuffer(2)
    case 'any':
      return random.pick([null, 'x', 1, [1], { k: 'v' }])
    case 'literal':
      return typeof json.value === 'object' ? jsonToConvex(json.value as never) : json.value
    case 'id':
      return json.tableName === 'projects'
        ? random.pick([own, foreign])
        : json.tableName === '_storage'
          ? file
          : note
    case 'array':
      return Array.from({ length: random.integer(4) }, () => genValue(random, json.value, mutate))
    case 'record':
      return Object.fromEntries(
        ['k1', 'k2']
          .slice(0, random.integer(3))
          .map((key) => [key, genValue(random, json.values.fieldType, mutate)]),
      )
    case 'object': {
      const value: Record<string, unknown> = {}
      for (const [key, field] of Object.entries(json.value)) {
        if (field.optional && random.integer(2) === 0) continue
        if (mutate && random.integer(8) === 0) continue // a required field missing
        value[key] = genValue(random, field.fieldType, mutate)
      }
      if (mutate && random.integer(8) === 0) value.zz = 1 // a field the validator does not have
      return value
    }
    case 'union':
      return genValue(random, random.pick(json.value), mutate)
  }
}

// ---- the reference: what Convex's backend decides, written down once for the cases convex-test cannot decide ----

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype

function accepts(json: ValidatorJson, value: unknown): boolean {
  switch (json.type) {
    case 'any':
      return true
    case 'null':
      return value === null
    case 'number':
    case 'bigint':
    case 'boolean':
    case 'string':
      return typeof value === json.type
    case 'bytes':
      return value instanceof ArrayBuffer
    case 'literal':
      return (
        ['string', 'number', 'boolean', 'bigint'].includes(typeof value) &&
        same(convexToJson(value as Value), json.value)
      )
    case 'id':
      return typeof value === 'string' && world!.tables.get(value) === json.tableName
    case 'array':
      return Array.isArray(value) && value.every((item) => accepts(json.value, item))
    case 'record':
      return (
        isPlain(value) &&
        Object.entries(value).every(
          ([key, item]) => accepts(json.keys, key) && accepts(json.values.fieldType, item),
        )
      )
    case 'object':
      return (
        isPlain(value) &&
        Object.keys(value).every((key) => key in json.value) &&
        Object.entries(json.value).every(([key, field]) =>
          value[key] === undefined ? field.optional : accepts(field.fieldType, value[key]),
        )
      )
    case 'union':
      return json.value.some((member) => accepts(member, value))
  }
}

/** The projects a value names: IDs at `v.id('projects')` positions of the members the value is. */
function projectsNamed(json: ValidatorJson, value: unknown): string[] {
  if (!accepts(json, value)) return []
  switch (json.type) {
    case 'id':
      return json.tableName === 'projects' ? [value as string] : []
    case 'array':
      return (value as unknown[]).flatMap((item) => projectsNamed(json.value, item))
    case 'record':
      return Object.values(value as object).flatMap((item) =>
        projectsNamed(json.values.fieldType, item),
      )
    case 'object':
      return Object.entries(json.value).flatMap(([key, field]) =>
        projectsNamed(field.fieldType, (value as Record<string, unknown>)[key]),
      )
    case 'union':
      return json.value.flatMap((member) => projectsNamed(member, value))
    default:
      return []
  }
}

/** Does the validator hold a literal convex-test rejects, or (`records`) a record it does not check? */
const holds = (json: ValidatorJson, records: boolean): boolean => {
  switch (json.type) {
    case 'literal':
      return !records && (typeof json.value === 'object' || isExotic(json.value))
    case 'array':
      return holds(json.value, records)
    case 'record':
      return records || holds(json.values.fieldType, records)
    case 'object':
      return Object.values(json.value).some((field) => holds(field.fieldType, records))
    case 'union':
      return json.value.some((member) => holds(member, records))
    default:
      return false
  }
}
const undecidable = (json: ValidatorJson) => holds(json, false) || holds(json, true)

async function decidedByConvex(index: number, name: string, value: unknown) {
  return await t.query(fn(index, name), { x: value } as never).then(
    () => true,
    (error: Error) => {
      if (/Validator error|ArgumentValidationError/.test(String(error))) return false
      throw error
    },
  )
}

test('matches() and defineFunctions agree with Convex about random validators and values', async () => {
  world ??= await setup()
  let index = 0
  await runSeededAuthCorpus(
    'functions-validators',
    CASES_PER_SEED,
    async (random, caseIndex, seed) => {
      const n = index++
      const validator = genValidator(random, 0)
      const json = (validator as unknown as { json: ValidatorJson }).json
      const members = json.type === 'union' ? json.value : []
      const memberValidators = (validator as unknown as { members?: GenericValidator[] }).members
      const exotic = holds(json, false)
      const source: Record<string, unknown> = {
        whole: queryGeneric({ args: { x: validator }, handler: async () => null }),
        // The library's own operation over the same argument.
        op: query({
          action: 'projects.read',
          args: { x: validator },
          returns: v.null(),
          handler: async () => null,
        }),
      }
      memberValidators?.forEach((member, i) => {
        source[`m${i}`] = queryGeneric({ args: { x: member }, handler: async () => null })
      })
      compiled.set(n, source)

      const isId = (table: string, id: string) => world!.tables.get(id) === table
      for (const value of [genValue(random, json, false), genValue(random, json, true)]) {
        const label = `seed ${seed} case ${caseIndex}: ${JSON.stringify(json)} with ${JSON.stringify(convexToJson(value as Value))}`
        // 1. The oracle itself: the reference agrees with Convex wherever Convex can decide.
        const wanted = accepts(json, value)
        if (!undecidable(json))
          expect(await decidedByConvex(n, 'whole', value), `reference vs Convex, ${label}`).toBe(
            wanted,
          )
        for (const [i, member] of members.entries())
          if (!undecidable(member))
            expect(
              await decidedByConvex(n, `m${i}`, value),
              `reference vs Convex, member ${i}, ${label}`,
            ).toBe(accepts(member, value))
        // 2. The matcher tenant discovery relies on: the whole validator and each union member.
        expect(matches(json, value, isId), `matches(), ${label}`).toBe(wanted)
        for (const [i, member] of members.entries())
          expect(matches(member, value, isId), `matches(), member ${i}, ${label}`).toBe(
            accepts(member, value),
          )
        // 3. The operation: every value Convex accepts runs, unless it names another tenant's project.
        if (exotic || !wanted) continue
        const call = world!.ann.query(fn(n, 'op'), { x: value } as never)
        if (projectsNamed(json, value).includes(world!.foreign))
          await expect(call, `must be refused, ${label}`).rejects.toThrow(/NOT_FOUND/)
        else expect(await call, `must run, ${label}`).toBeNull()
      }
    },
    'functions',
  )
})
