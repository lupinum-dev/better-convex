import { defineConvexAuthClient } from '@lupinum/better-convex-nuxt/better-auth/client'
import { emailOTPClient } from 'better-auth/client/plugins'

export default defineConvexAuthClient({
  plugins: [emailOTPClient()],
})
