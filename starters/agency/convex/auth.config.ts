import { getConvexAuthProvider } from 'better-convex-nuxt/convex-auth'
import type { AuthConfig } from 'convex/server'

export default {
  providers: [getConvexAuthProvider()],
} satisfies AuthConfig
