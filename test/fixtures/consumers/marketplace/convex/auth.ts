import { consentScopes } from '@lupinum/better-convex-functions'
import { createBetterConvexAuth } from '@lupinum/better-convex-nuxt/better-auth/server'

import { components } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { policy } from './policy'

/** Also the name of the MCP resource that host clients are bound to. */
export const APP_NAME = 'Marketplace'

export const auth = createBetterConvexAuth<DataModel>(components.betterAuth, {
  appName: APP_NAME,
  oauth: { mcp: { scopes: consentScopes(policy) } },
})
