import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Plugin } from 'vite'

import { type Mutant, mutants } from './mutants'

/** The row `BC_MUTANT` names, or `undefined` without `BC_MUTANT`. */
export function activeMutant(): Mutant | undefined {
  const id = process.env.BC_MUTANT
  if (!id) return undefined
  const row = mutants.find((mutant) => mutant.id === id)
  if (!row) throw new Error(`BC_MUTANT: no mutant row "${id}" in test/mutants/mutants.ts`)
  return row
}

/**
 * Applies `row` to the text of its file. Appends one JSON line `{ id, file, count }` to the file
 * named by `BC_MUTANT_REPORT`, and throws unless `find` matches exactly once.
 */
export function applyMutant(row: Mutant, code: string): string {
  const count = code.split(row.find).length - 1
  const report = process.env.BC_MUTANT_REPORT
  if (report) appendFileSync(report, `${JSON.stringify({ id: row.id, file: row.file, count })}\n`)
  if (count !== 1) {
    throw new Error(`BC_MUTANT ${row.id}: "find" matches ${count} times in ${row.file}, not once`)
  }
  return code.replace(row.find, () => row.replace)
}

/**
 * Applies the mutant named by `BC_MUTANT` as its file loads, in memory only.
 * Without `BC_MUTANT` the plugin does nothing. The working tree is never
 * written, so an interrupted run leaves no mutated guard behind.
 * `test/mutants/run.ts` reads the report. A type test runs `tsc` on files, so
 * it applies the row to its own copy of the sources with `applyMutant`.
 */
export function mutantPlugin(root: string): Plugin {
  const row = activeMutant()
  if (!row) return { name: 'bc-mutant' }
  const target = resolve(root, row.file)
  return {
    name: 'bc-mutant',
    // Before esbuild, so `find` matches the TypeScript source as written.
    enforce: 'pre',
    transform(code, moduleId) {
      if (moduleId.split('?')[0] !== target) return
      return applyMutant(row, code)
    },
  }
}
