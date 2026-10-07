import { execFile } from 'node:child_process'
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterAll, expect, test } from 'vitest'

import { activeMutant, applyMutant } from '../../../test/mutants/plugin'

// What a developer sees from the type checker, as packages/functions/test/types.test.ts does for
// the functions package. Each scenario copies the door fixture (test/door) as an app, applies a
// few text edits and runs tsc with declarations on.
//
// tsc reads files, not vitest's modules, so under `pnpm test:mutants` a scenario applies the
// active row to its own copy of the package sources.

const packageRoot = join(import.meta.dirname, '..')
const repoRoot = join(packageRoot, '../..')
// A sibling of test/, so the copy finds node_modules as test/door does.
const scratch = join(packageRoot, '.tmp')
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
const run = promisify(execFile)
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

type Edit = [file: string, find: string, replace: string]

/** The package's tsconfig paths as absolute paths, pointed at a mutated copy of `src` if needed. */
function pathsFor(dir: string) {
  const { paths } = JSON.parse(readFileSync(join(packageRoot, 'tsconfig.json'), 'utf8'))
    .compilerOptions as { paths: Record<string, string[]> }
  // A row in the src of either package: tsc reads a copy of that src with the row applied.
  const row = activeMutant()
  const src =
    row && /^packages\/(?:agents|functions)\/src\/[^/]+$/.test(row.file)
      ? resolve(repoRoot, dirname(row.file))
      : undefined
  const copy = join(dir, 'mutated-src')
  if (row && src) {
    cpSync(src, copy, { recursive: true })
    const file = join(copy, basename(row.file))
    writeFileSync(file, applyMutant(row, readFileSync(file, 'utf8')))
  }
  return Object.fromEntries(
    Object.entries(paths).map(([name, [target]]) => {
      const absolute = resolve(packageRoot, target!)
      const inSrc = src !== undefined && absolute.startsWith(`${src}/`)
      return [name, [inSrc ? join(copy, relative(src, absolute)) : absolute]]
    }),
  )
}

/** The functions fixtures' auth fake in place of the real Better Auth component. */
const fakeAuth: Edit[] = [
  [
    'fns.ts',
    "import { createBetterConvexAuth } from '@lupinum/better-convex-nuxt/better-auth/server'",
    "import { people } from '../../../../functions/test/app/people'",
  ],
  ['fns.ts', "import { betterAuthComponent } from '../support'\n", ''],
  ['fns.ts', 'createBetterConvexAuth<DataModel>(betterAuthComponent, {})', 'people<DataModel>()'],
]

async function typeErrors(id: string, edits: Edit[]) {
  const dir = join(scratch, id)
  rmSync(dir, { recursive: true, force: true })
  // The app: the door fixture without its tests, its test setup and the module that revokes
  // grants. Checking Better Auth's types took two thirds of each run, so `fakeAuth` swaps it out.
  cpSync(join(import.meta.dirname, 'door'), join(dir, 'door'), {
    recursive: true,
    filter: (path) => !/(?:\.test|setup|connections)\.ts$/.test(path),
  })
  cpSync(join(import.meta.dirname, 'support.ts'), join(dir, 'support.ts'))
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      extends: '../../tsconfig.json',
      compilerOptions: {
        types: ['node'],
        paths: pathsFor(dir),
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: 'out',
      },
      include: ['./door/*.ts', './support.ts'],
    }),
  )
  for (const [file, find, replace] of [...fakeAuth, ...edits]) {
    const path = join(dir, 'door', file)
    const text = readFileSync(path, 'utf8')
    if (!text.includes(find)) throw new Error(`${id}: "${find}" not found in ${file}`)
    writeFileSync(path, text.replace(find, replace))
  }
  const out = await run(process.execPath, [tsc, '-p', 'tsconfig.json', '--pretty', 'false'], {
    cwd: dir,
  }).then(
    ({ stdout }) => stdout,
    (error: { stdout: string }) => error.stdout,
  )
  // One entry per error, with its continuation lines.
  return out.split(/\n(?=\S)/).filter((entry) => entry.includes('error TS'))
}

// V5 for the second package: `export const tools = defineTools(...)` must emit declarations
// (TS4023 when its type names something the packages do not export).
test.concurrent('the app type-checks and emits declarations', { timeout: 60_000 }, async () => {
  expect(await typeErrors('baseline', [])).toEqual([])
})

// The summary runs before the request is stored and fingerprints what it reads: a write, a nested
// call or a scheduled function in it would act before a person approved anything.
test.concurrent(
  'an approval summary cannot write, call or schedule functions',
  { timeout: 60_000 },
  async () => {
    const errors = await typeErrors('summary', [
      [
        'projects.ts',
        "import { paginationOptsValidator, paginationResultValidator } from 'convex/server'",
        "import { makeFunctionReference, paginationOptsValidator, paginationResultValidator } from 'convex/server'",
      ],
      [
        'projects.ts',
        '  approval: async (ctx, { projectId }) =>\n    `Archive the project "${(await ctx.db.get(projectId))?.name ?? \'unknown\'}".`,',
        [
          '  approval: async (ctx, { projectId }) => {',
          "    const create = makeFunctionReference<'mutation'>('projects:create')",
          "    await ctx.db.patch(projectId, { status: 'archived' })",
          '    await ctx.runMutation(create, {})',
          '    await ctx.scheduler.runAfter(0, create, {})',
          "    await ctx.runQuery(makeFunctionReference<'query'>('projects:page'), {})",
          "    return 'Archive it.'",
          '  },',
        ].join('\n'),
      ],
    ])
    expect(
      errors.map((error) => error.match(/^(\S+): error TS\d+: Property '(\w+)'/)?.slice(1)),
    ).toEqual([
      ['door/projects.ts(30,18)', 'patch'],
      ['door/projects.ts(31,15)', 'runMutation'],
      ['door/projects.ts(32,15)', 'scheduler'],
      ['door/projects.ts(33,15)', 'runQuery'],
    ])
  },
)

// A misspelled argument in `tool.args` type-checked, and the model never read that description.
test.concurrent(
  "a tool's argument description must name an argument",
  { timeout: 60_000 },
  async () => {
    const errors = await typeErrors('toolArgs', [
      ['shapes.ts', "args: { list: 'Project IDs.' },", "args: { lists: 'Project IDs.' },"],
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^door\/shapes\.ts.*'lists'/)
  },
)
