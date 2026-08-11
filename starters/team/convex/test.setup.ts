/// <reference types="vite/client" />

import rateLimiter from '@convex-dev/rate-limiter/test'
import { convexTest } from 'convex-test'

import betterAuthSchema from './betterAuth/schema'
import schema from './schema'

process.env.SITE_URL ??= 'http://localhost:3000'
process.env.CONVEX_SITE_URL ??= 'http://localhost:3210'
process.env.BETTER_AUTH_SECRETS ??=
  '0:team-convex-test-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ'
// Unit tests capture the local verification ceremony and must never inherit a
// developer or CI delivery credential that could send real email.
delete process.env.RESEND_API_KEY
delete process.env.RESEND_FROM_EMAIL

export const modules = import.meta.glob('./**/*.ts', {
  eager: false,
})

const betterAuthModules = import.meta.glob('./betterAuth/**/*.ts')

export function initConvexTest() {
  const t = convexTest(schema, modules)
  t.registerComponent('betterAuth', betterAuthSchema, betterAuthModules)
  rateLimiter.register(t)
  return t
}
