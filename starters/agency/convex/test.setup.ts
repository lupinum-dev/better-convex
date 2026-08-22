/// <reference types="vite/client" />

import betterAuth from '@lupinum/better-convex-nuxt/better-auth/test'
import { convexTest } from 'convex-test'

import schema from './schema'

export const modules = import.meta.glob('./**/*.ts', {
  eager: false,
})

export function initConvexTest() {
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  return t
}
