/**
 * Runs the mutation check: `pnpm test:mutants`, or `pnpm test:mutants --only <id>[,<id>…]`.
 *
 * 1. Baseline: one vitest run over the `kills` files of the selected rows.
 *    Every name in every `kills` list must exist and pass.
 * 2. Each row, one after the other: vitest runs the row's `kills` files in the
 *    row's projects, with `BC_MUTANT=<id>`. The plugin applies the row in
 *    memory and reports each replacement.
 * 3. A row fails when the plugin did not replace `find` exactly once, when a
 *    `kills` test passes, when a `kills` test did not run (the mutant broke
 *    the module before the tests ran: fix the row), or when it failed in its
 *    `beforeEach` or `afterEach` (the mutant broke the setup, not the guard).
 * 4. A full run fails when an invariant row (`| S<n> |`) in section 6 of
 *    internal/functions-and-agents/plan.md has no mutant row.
 *
 * Nothing is written to the working tree: the reports go to a temporary
 * directory, so an interrupted run leaves `git status` as it was.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Mutant, mutants } from './mutants.ts'

const root = join(import.meta.dirname, '../..')
const vitest = join(root, 'node_modules/.bin/vitest')
const defaultProjects = ['functions', 'agents']
const scratch = mkdtempSync(join(tmpdir(), 'bc-mutants-'))
let child: ReturnType<typeof spawn> | undefined

function stop(signal: NodeJS.Signals) {
  child?.kill(signal)
  rmSync(scratch, { recursive: true, force: true })
  process.exit(130)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

type Report = {
  testResults: {
    name: string
    assertionResults: { ancestorTitles: string[]; title: string; status: string }[]
  }[]
}

/** Runs vitest and returns each test's status by "file > describe > test". */
async function runVitest(projects: string[], files: string[], env: Record<string, string>) {
  const output = join(scratch, 'vitest.json')
  rmSync(output, { force: true })
  const hooks = join(scratch, 'hooks.txt')
  rmSync(hooks, { force: true })
  const args = [
    'run',
    ...projects.map((name) => `--project=${name}`),
    '--reporter=json',
    `--reporter=${join(import.meta.dirname, 'hooks-reporter.ts')}`,
  ]
  child = spawn(vitest, [...args, `--outputFile=${output}`, ...files], {
    cwd: root,
    env: { ...process.env, ...env, BC_MUTANT_HOOKS: hooks },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr?.on('data', (chunk) => (stderr += chunk))
  await new Promise((done) => child?.on('close', done))
  const statuses = new Map<string, string>()
  const failedInHook = new Set(existsSync(hooks) ? readFileSync(hooks, 'utf8').split('\n') : [])
  if (!existsSync(output)) return { statuses, stderr }
  const report = JSON.parse(readFileSync(output, 'utf8')) as Report
  for (const file of report.testResults) {
    const path = file.name.slice(root.length + 1)
    for (const test of file.assertionResults) {
      const name = [path, ...test.ancestorTitles, test.title].join(' > ')
      statuses.set(name, failedInHook.has(name) ? 'failed in a hook' : test.status)
    }
  }
  return { statuses, stderr }
}

const projectsOf = (row: Mutant) => row.projects ?? defaultProjects
const fileOf = (name: string) => name.split(' > ')[0]!

const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : undefined
const ids = new Set<string>()
for (const row of mutants) {
  if (ids.has(row.id)) throw new Error(`Two mutant rows have the id "${row.id}".`)
  if (row.kills.length === 0) throw new Error(`Mutant row "${row.id}" names no test in kills.`)
  ids.add(row.id)
}
const onlyIds = only?.split(',')
for (const id of onlyIds ?? []) if (!ids.has(id)) throw new Error(`No mutant row "${id}".`)
const rows = onlyIds ? mutants.filter((row) => onlyIds.includes(row.id)) : mutants

let failed = 0
let failedRows = 0

// 1. Baseline.
const baseline = await runVitest(
  [...new Set(rows.flatMap(projectsOf))],
  [...new Set(rows.flatMap((row) => row.kills.map(fileOf)))],
  {},
)
for (const row of rows)
  for (const name of row.kills) {
    const status = baseline.statuses.get(name)
    if (status !== 'passed') {
      failed++
      console.log(`BASELINE ${row.id}: "${name}" is ${status ?? 'not found'}, expected passed`)
    }
  }
if (failed) {
  console.log(baseline.stderr.slice(-4000))
  rmSync(scratch, { recursive: true, force: true })
  process.exit(1)
}

// 2. and 3. One run per row.
for (const row of rows) {
  const reportFile = join(scratch, `${row.id}.jsonl`)
  const files = [...new Set(row.kills.map(fileOf))]
  const { statuses } = await runVitest(projectsOf(row), files, {
    BC_MUTANT: row.id,
    BC_MUTANT_REPORT: reportFile,
    // The baseline built the packages; the integration rows change only the starter copy.
    BCN_INTEGRATION_SKIP_BUILD: '1',
  })
  const counts = existsSync(reportFile)
    ? readFileSync(reportFile, 'utf8')
        .trim()
        .split('\n')
        .map((line) => (JSON.parse(line) as { count: number }).count)
    : []
  const problems: string[] = []
  if (counts.length === 0) problems.push(`${row.file} was never loaded`)
  else if (counts.some((count) => count !== 1))
    problems.push(`"find" matched ${counts.find((count) => count !== 1)} times, not once`)
  for (const name of row.kills) {
    const status = statuses.get(name)
    if (status === 'passed') problems.push(`survived: "${name}"`)
    else if (status === 'failed in a hook')
      problems.push(`failed in a hook, not in the test: "${name}"`)
    else if (status !== 'failed') problems.push(`did not run: "${name}"`)
  }
  if (problems.length) failedRows++
  console.log(
    `${problems.length ? 'FAIL' : 'ok  '} ${row.id}${problems.map((p) => `\n     ${p}`).join('')}`,
  )
}

// 4. Every invariant of plan.md section 6 has a row.
const plan = readFileSync(join(root, 'internal/functions-and-agents/plan.md'), 'utf8')
const section = plan.slice(plan.indexOf('## 6.'), plan.indexOf('## 7.'))
const guarded = new Set(mutants.map((row) => row.guards))
const invariants = [...section.matchAll(/^\|\s*(S\d+)\s*\|/gm)].map((match) => match[1]!)
const missing = invariants.filter((invariant) => !guarded.has(invariant))
if (!only && invariants.length === 0) {
  console.log('FAIL found no invariant rows in plan.md section 6')
  failed++
} else if (!only && missing.length) {
  console.log(`FAIL no mutant row for ${missing.join(', ')}`)
  failed++
}

rmSync(scratch, { recursive: true, force: true })
console.log(`\n${rows.length} rows, ${failedRows} failed`)
process.exit(failed || failedRows ? 1 : 0)
