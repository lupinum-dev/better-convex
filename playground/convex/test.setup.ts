/**
 * Test Setup for Convex-Test
 *
 * Provides the module glob for integration tests.
 */

/// <reference types="vite/client" />

import betterAuth from 'better-convex-nuxt/convex-auth/test'
import { convexTest } from 'convex-test'

import schema from './schema'

// Glob all convex files for convex-test
export const modules = import.meta.glob('./**/*.ts', {
  // Exclude test files from being loaded as modules
  eager: false,
})

export function initConvexTest() {
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  return t
}
