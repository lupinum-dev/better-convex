/// <reference types="vite/client" />

import betterAuth from '@lupinum/better-convex-nuxt/better-auth/test'
import { convexTest } from 'convex-test'
import { vi } from 'vitest'

import schema from './schema'

export const modules = import.meta.glob('./**/*.ts', { eager: false })

/** convex-test with the real Better Auth component. */
export function initConvexTest() {
  // The issuer and the resource of an MCP grant (`grantMcp`) come from these.
  vi.stubEnv('SITE_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.example.test')
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  return t
}
