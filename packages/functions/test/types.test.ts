import { execFile } from 'node:child_process'
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterAll, expect, test } from 'vitest'

// What a developer sees from the type checker after common mistakes. Each
// scenario copies the fixture app (test/app), applies a few text edits and runs
// tsc, so the scenarios cannot drift from the app. Each names the STRESS.md
// row of the walking skeleton it keeps fixed.

const packageRoot = join(import.meta.dirname, '..')
// A sibling of test/, so the copy's tsconfig paths (`../../src`) still resolve.
const scratch = join(packageRoot, '.tmp')
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
const run = promisify(execFile)
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

type Edit = [file: string, find: string, replace: string]

async function typeErrors(id: string, edits: Edit[], tsconfig = 'tsconfig.json') {
  const dir = join(scratch, id)
  rmSync(dir, { recursive: true, force: true })
  cpSync(join(import.meta.dirname, 'app'), dir, { recursive: true })
  for (const [file, find, replace] of edits) {
    const path = join(dir, file)
    const text = readFileSync(path, 'utf8')
    if (!text.includes(find)) throw new Error(`${id}: "${find}" not found in ${file}`)
    writeFileSync(path, text.replace(find, replace))
  }
  // Run in the copy, so tsc names files as test/app does: `functions.ts(44,5): error TS…`.
  const out = await run(process.execPath, [tsc, '-p', tsconfig, '--pretty', 'false'], {
    cwd: dir,
  }).then(
    ({ stdout }) => stdout,
    (error: { stdout: string }) => error.stdout,
  )
  // One entry per error, with its continuation lines.
  return out.split(/\n(?=\S)/).filter((entry) => entry.includes('error TS'))
}

// V5: `export const fns = defineFunctions(...)` failed declaration emit (TS4023, a type it could not name).
test.concurrent('the app type-checks and emits declarations', { timeout: 60_000 }, async () => {
  expect(await typeErrors('baseline', [], 'tsconfig.declaration.json')).toEqual([])
})

// E1: a typo in `rules` added unrelated `Id<"users">` errors in other files.
test.concurrent('a typo in a rule gives one error, at the rule', { timeout: 60_000 }, async () => {
  const errors = await typeErrors('E1', [
    ['functions.ts', "projects: tenant('organizationId')", "projects: tenant('organizationI')"],
  ])
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatch(/^functions\.ts[\s\S]*Did you mean '"organizationId"'/)
})

// Round 1 review: tenant() on a field that holds no ID type-checked, then hid every row.
test.concurrent(
  'a rule on a field that holds no ID is a type error',
  { timeout: 60_000 },
  async () => {
    const errors = await typeErrors('field', [
      ['functions.ts', "projects: tenant('organizationId')", "projects: tenant('name')"],
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^functions\.ts/)
  },
)

// Round 1 review: a job's result went into the feed unchecked; a Date rolled back the job's work.
test.concurrent(
  'a job that returns a value Convex cannot store is a type error',
  { timeout: 60_000 },
  async () => {
    const errors = await typeErrors('job', [
      ['projects.ts', 'return { deleted: old.length }', 'return { at: new Date() }'],
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^projects\.ts/)
  },
)

// X1: a new table must force a rule decision.
test.concurrent(
  'a table without a rule is a type error that names it',
  { timeout: 60_000 },
  async () => {
    const errors = await typeErrors('X1', [
      [
        'schema.ts',
        '  ...libraryTables,',
        '  invoices: defineTable({ total: v.number() }),\n  ...libraryTables,',
      ],
    ])
    expect(errors.join('\n')).toMatch(/^functions\.ts.*invoices/m)
  },
)

// E4: an action name not in the policy.
test.concurrent(
  'a misspelled action is a type error with a suggestion',
  { timeout: 60_000 },
  async () => {
    const errors = await typeErrors('E4', [
      ['projects.ts', "action: 'projects.rename'", "action: 'projects.renam'"],
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^projects\.ts.*projects\.renam/)
  },
)

// W5: a public action's handler may run for a visitor, who has no user.
test.concurrent(
  'a public action must handle visitors before it reads ctx.actor.user',
  { timeout: 60_000 },
  async () => {
    const errors = await typeErrors('W5', [
      [
        'policy.ts',
        "agents: { 'projects.archive': 'approve' },",
        "agents: { 'projects.archive': 'approve' },\n  public: ['organizations.list'],",
      ],
    ])
    expect(errors.join('\n')).toMatch(
      /^projects\.ts[\s\S]*Property 'user' does not exist on type 'Visitor'/m,
    )
  },
)

// E13, K5: `a.b.*` patterns and agent rules that read the input type-check.
test.concurrent('three-part patterns and input rules type-check', { timeout: 60_000 }, async () => {
  const errors = await typeErrors('E13', [
    ['policy.ts', "'clients.create',", "'clients.create', 'billing.invoices.create',"],
    ['policy.ts', "owner: ['*'],", "owner: ['*'],\n    accountant: ['billing.invoices.*'],"],
    [
      'policy.ts',
      "agents: { 'projects.archive': 'approve' },",
      "agents: { 'projects.archive': 'approve', 'billing.invoices.create': (input) => (input.total > 1000 ? 'approve' : 'allow') },",
    ],
  ])
  expect(errors).toEqual([])
})
