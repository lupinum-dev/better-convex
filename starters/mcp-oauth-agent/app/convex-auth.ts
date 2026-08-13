import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { defineConvexAuthClient } from '@lupinum/better-convex-nuxt/auth-client'

export default defineConvexAuthClient({ plugins: [oauthProviderClient()] })
