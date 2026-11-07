import { createBetterConvexAuth } from '@lupinum/better-convex-nuxt/better-auth/server'

import { components } from './_generated/api'
import type { DataModel } from './_generated/dataModel'

export const auth = createBetterConvexAuth<DataModel>(components.betterAuth, {
  // Sign-in with a code sent by email. Without an `email` hook, the code appears in the
  // `pnpm dev` output while SITE_URL is http://localhost.
  emailOTP: {},
  // Put the email address in the session token, so pages can show it.
  defineSessionClaims: ({ user }) => ({ email: user.email }),
})
export const createAuth = auth.createAuth
export const { ensureSigningKey, pruneSigningKeys, rotateSigningKey } = auth.jwksOperatorFunctions()
export const { onCreate, onUpdate, onDelete } = auth.triggerFunctions()
