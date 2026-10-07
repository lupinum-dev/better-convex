import { afterEach } from 'vitest'

declare module 'vitest' {
  interface TaskMeta {
    /** Its `beforeEach` failed, so the test body never ran (see hooks-reporter.ts). */
    beforeEachFailed?: boolean
  }
}

// A beforeEach that throws stays in state `run`: vitest sets `pass` only when every one finished
// (@vitest/runner 4.1, callSuiteHook), and then skips the test body.
afterEach(({ task }) => {
  const state = task.result?.hooks?.beforeEach
  if (state !== undefined && state !== 'pass') task.meta.beforeEachFailed = true
})
