import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Plugin } from 'vite'

import { mutants } from './mutants'

/**
 * Applies the mutant named by `BC_MUTANT` as its file loads, in memory only.
 * Without `BC_MUTANT` the plugin does nothing. Each transform of the row's
 * file appends one JSON line `{ id, file, count }` to the file named by
 * `BC_MUTANT_REPORT`, and throws unless `find` matches exactly once. The
 * working tree is never written, so an interrupted run leaves no mutated
 * guard behind. `test/mutants/run.ts` reads the report.
 */
export function mutantPlugin(root: string): Plugin {
  const id = process.env.BC_MUTANT
  if (!id) return { name: 'bc-mutant' }
  const row = mutants.find((mutant) => mutant.id === id)
  if (!row) throw new Error(`BC_MUTANT: no mutant row "${id}" in test/mutants/mutants.ts`)
  const target = resolve(root, row.file)
  const report = process.env.BC_MUTANT_REPORT
  return {
    name: 'bc-mutant',
    // Before esbuild, so `find` matches the TypeScript source as written.
    enforce: 'pre',
    transform(code, moduleId) {
      if (moduleId.split('?')[0] !== target) return
      const count = code.split(row.find).length - 1
      if (report) appendFileSync(report, `${JSON.stringify({ id, file: row.file, count })}\n`)
      if (count !== 1) {
        throw new Error(`BC_MUTANT ${id}: "find" matches ${count} times in ${row.file}, not once`)
      }
      return code.replace(row.find, () => row.replace)
    },
  }
}
