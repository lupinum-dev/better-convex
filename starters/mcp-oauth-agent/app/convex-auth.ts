import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { defineConvexAuthClient } from 'better-convex-nuxt/auth-client'

export default defineConvexAuthClient({ plugins: [oauthProviderClient()] })
