// Host-owned auth-client definition WITH an admitted organization client plugin, discovered
// by the `<srcDir>/convex-auth.ts` convention . The module prepends
// the Convex token-sync plugin and generates the type registry from this value.
import { defineConvexAuthClient } from '@lupinum/better-convex-nuxt/better-auth/client'
import { organizationClient } from 'better-auth/client/plugins'

export default defineConvexAuthClient({
  plugins: [organizationClient()],
})
