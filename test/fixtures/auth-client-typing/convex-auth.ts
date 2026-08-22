// Host-owned auth-client definition WITH the API-key client plugin, discovered
// by the `<srcDir>/convex-auth.ts` convention . The module prepends
// the Convex token-sync plugin and generates the type registry from this value.
import { apiKeyClient } from '@better-auth/api-key/client'
import { defineConvexAuthClient } from '@lupinum/better-convex-nuxt/better-auth/client'

export default defineConvexAuthClient({
  plugins: [apiKeyClient()],
})
