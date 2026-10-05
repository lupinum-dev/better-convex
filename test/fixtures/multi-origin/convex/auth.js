import { createBetterConvexAuth } from '@lupinum/better-convex-nuxt/better-auth/server'
import { componentsGeneric } from 'convex/server'

const components = componentsGeneric()

export const auth = createBetterConvexAuth(components.betterAuth, {
  siteOrigins: () => {
    const origin = process.env.SITE_B_ORIGIN
    if (!origin) throw new Error('SITE_B_ORIGIN is required')
    return [origin]
  },
})

export const { ensureSigningKey, pruneSigningKeys, rotateSigningKey } = auth.jwksOperatorFunctions()
