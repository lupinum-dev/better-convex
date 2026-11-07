/// <reference types="vite/client" />

import { convexTest } from 'convex-test'

import betterAuthSchema from './betterAuth/schema'
import schema from './schema'

export const modules = import.meta.glob('./**/*.ts', { eager: false })
const betterAuthModules = import.meta.glob('./betterAuth/**/*.ts')

/** convex-test with this app's local Better Auth component. */
export function initConvexTest() {
  const t = convexTest(schema, modules)
  t.registerComponent('betterAuth', betterAuthSchema, betterAuthModules)
  return t
}
