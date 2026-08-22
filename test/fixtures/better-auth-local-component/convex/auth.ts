import { createBetterConvexAuth } from '@lupinum/better-convex-nuxt/better-auth/server'

import { components } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
export const betterConvexAuth = createBetterConvexAuth<DataModel>(components.betterAuth, {
  organization: {},
})

export const { authComponent, createAuth } = betterConvexAuth

// Pre-traffic operator ceremony: provision/rotate the one official JWT key graph.
export const { rotateSigningKey } = betterConvexAuth.jwksOperatorFunctions()
