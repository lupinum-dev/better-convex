import { getConvexAuthProvider } from '@lupinum/better-convex-nuxt/better-auth/server'
import type { AuthConfig } from 'convex/server'

export default { providers: [getConvexAuthProvider()] } satisfies AuthConfig
