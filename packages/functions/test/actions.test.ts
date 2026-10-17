import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { expect, test } from 'vitest'

import schema from './rules/schema'

// Public actions (fns.action): the check before the handler, and the actor the handler hands on.
// Contract: docs/content/docs/3.build/8.functions/4.internal-operations.md, "Public actions".
// The limit, row-rule and audit cells of the action door are in ./doors.test.ts.
const modules = import.meta.glob(['./limits/*.ts', './limits/_generated/*.ts'])
const fn = (name: string) => makeFunctionReference<'action'>(`ops:${name}`)

/** Org A: Ann owns it, Vic views it. */
async function setup() {
  const t = convexTest({ schema, modules })
  const ids = await t.run(async (ctx) => {
    const ann = await ctx.db.insert('users', { authId: 'ann' })
    const vic = await ctx.db.insert('users', { authId: 'vic' })
    const a = await ctx.db.insert('orgs', { name: 'A' })
    await ctx.db.insert('memberships', { orgId: a, userId: ann, role: 'owner' })
    await ctx.db.insert('memberships', { orgId: a, userId: vic, role: 'viewer' })
    const pa = await ctx.db.insert('projects', { orgId: a, name: 'A one', archived: false })
    return { ann, pa }
  })
  return {
    t,
    ...ids,
    files: () => t.run(async (ctx) => (await ctx.db.system.query('_storage').collect()).length),
  }
}

const codeOf = (call: Promise<unknown>) =>
  call.then(
    () => 'ok',
    (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
  )

// Catches: a handler that runs before the caller is checked, or nested calls that run as someone
// else (the system, a visitor) instead of the person the check found.
test('an allowed person runs the action, and its internal operations see the same person', async () => {
  const { t, ann, pa, files } = await setup()
  const { actor, nested } = await t
    .withIdentity({ subject: 'ann' })
    .action(fn('snapshot'), { projectId: pa })
  expect(actor).toMatchObject({ kind: 'person', authId: 'ann', user: { _id: ann } })
  expect(nested).toEqual(actor)
  expect(await files()).toBe(1)
})

// Catches: a check that refuses only inside the nested calls, after the handler already did work
// outside the database (here: stored a file).
test.each([
  ['a role without the action', { subject: 'vic' }, 'FORBIDDEN'],
  ['a visitor, for an action that is not public', null, 'NOT_SIGNED_IN'],
  ['a signed-in stranger without a user row', { subject: 'nobody' }, 'ACCOUNT_DISABLED'],
] as const)('%s is refused before the handler runs', async (_name, identity, code) => {
  const { t, pa, files } = await setup()
  const as = identity ? t.withIdentity(identity) : t
  expect(await codeOf(as.action(fn('snapshot'), { projectId: pa }))).toBe(code)
  expect(await files()).toBe(0)
})

// Catches: an action whose arguments name no tenant running for anyone signed in. With no tenant
// the role is roleOf's answer for null (signedIn in this app), which does not allow archiving.
test.each([
  ['a viewer', 'vic'],
  ['the owner', 'ann'],
] as const)(
  '%s calling an owner-only action without a tenant is refused before it runs',
  async (_name, subject) => {
    const { t, files } = await setup()
    expect(await codeOf(t.withIdentity({ subject }).action(fn('archiveMaybe'), {}))).toBe(
      'FORBIDDEN',
    )
    expect(await files()).toBe(0)
  },
)

// Keep: an action the policy lists in `signedIn` runs for every signed-in person, without a tenant.
test('an action in signedIn runs for a viewer', async () => {
  const { t, files } = await setup()
  expect(await codeOf(t.withIdentity({ subject: 'vic' }).action(fn('myReport'), {}))).toBe('ok')
  expect(await codeOf(t.action(fn('myReport'), {}))).toBe('NOT_SIGNED_IN')
  expect(await files()).toBe(1)
})

// Keep: a visitor still reaches an action the policy lists in `public`.
// Catches: an action whose work happens outside the database (a PDF, an email) running without
// limit. Its check takes the token (here 2 a minute for everyone), before the handler runs.
test('a visitor runs an action whose name is public, until its limit', async () => {
  const { t } = await setup()
  expect(await t.action(fn('contactAction'), {})).toBe('visitor')
  expect(await t.action(fn('contactAction'), {})).toBe('visitor')
  expect(await codeOf(t.action(fn('contactAction'), {}))).toBe('RATE_LIMITED')
})

// Catches: a public action that accepts the envelope internal operations take. A client could
// then name any actor, the system included, and skip every check.
test('a client cannot hand a public action an actor', async () => {
  const { t, pa, files } = await setup()
  const forged = { actingAs: { kind: 'system', job: 'x' }, input: { projectId: pa } }
  expect(await codeOf(t.action(fn('snapshot'), forged as never))).toMatch(/Validator error/)
  expect(await files()).toBe(0)
})

// Catches: a missing export of the check failing with Convex's bare "no such function".
test('an action whose check is not exported says what to export', async () => {
  const { t } = await setup()
  await expect(t.action(fn('unwired'), {})).rejects.toThrow(
    'contact.send: fns.action names fns:notExported as its check, but no module exports it there.',
  )
})
