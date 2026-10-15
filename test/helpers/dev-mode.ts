declare global {
  // Read by the `import.meta.dev` replacement in the unit and security projects (vitest.config.ts).
  var __BCN_TEST_DEV__: boolean | undefined
}

/**
 * Runs `run` as a development build: `import.meta.dev` is `true` in every
 * source module until `run` settles. Outside it the code under test sees
 * `false`, the production branch.
 */
export async function inDevelopment<T>(run: () => Promise<T>): Promise<T> {
  globalThis.__BCN_TEST_DEV__ = true
  try {
    return await run()
  } finally {
    globalThis.__BCN_TEST_DEV__ = undefined
  }
}
