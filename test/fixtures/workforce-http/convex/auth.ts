import { createBetterConvexAuth } from '@lupinum/better-convex-nuxt/better-auth/server'

import { components } from './_generated/api'
import type { DataModel } from './_generated/dataModel'

export const betterConvexAuth = createBetterConvexAuth<DataModel>(components.betterAuth, {
  workforce: true,
  beforeUserCreate: ({ user }) => ({
    allowed: /^workforce-[0-9a-f-]+@example\.test$/u.test(user.email),
  }),
})
export const { authComponent, createAuth } = betterConvexAuth
export const { rotateSigningKey } = betterConvexAuth.jwksOperatorFunctions()
