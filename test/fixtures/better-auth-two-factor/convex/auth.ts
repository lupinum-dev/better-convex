import { createBetterConvexAuth } from '@lupinum/better-convex-nuxt/better-auth/server'

import { components } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { createTwoFactorOptions } from './betterAuth/schemaPlugins'

export const betterConvexAuth = createBetterConvexAuth<DataModel>(components.betterAuth, {
  // This fixture deliberately enables Better Auth's signed session cache. The
  // token tests alter canonical state and prove BCN re-reads it.
  session: { cookieCache: { enabled: true, maxAge: 5 * 60, strategy: 'compact' } },
  twoFactor: createTwoFactorOptions(),
})

export const { authComponent, createAuth } = betterConvexAuth
export const { rotateSigningKey } = betterConvexAuth.jwksOperatorFunctions()
