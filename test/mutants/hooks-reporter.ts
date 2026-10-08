import { appendFileSync } from 'node:fs'
import { relative } from 'node:path'

import type { Reporter, TestCase } from 'vitest/node'

import type {} from './hook-setup'

/**
 * Writes each test whose `beforeEach` failed to `BC_MUTANT_HOOKS`. Such a test fails without
 * running its body, so a mutant that breaks the setup has not been caught by it (release review,
 * 2026-10-07). `hook-setup.ts`, which the mutant plugin adds during a run, marks those tests.
 */
export default class HookFailures implements Reporter {
  onTestCaseResult(test: TestCase) {
    const file = process.env.BC_MUTANT_HOOKS
    if (!file || !test.meta().beforeEachFailed) return
    appendFileSync(
      file,
      `${[relative(process.cwd(), test.module.moduleId), test.fullName].join(' > ')}\n`,
    )
  }
}
