import { createBetterConvexAuth } from '@lupinum/better-convex-nuxt/better-auth/server'
import { componentsGeneric } from 'convex/server'

const components = componentsGeneric()

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

export const auth = createBetterConvexAuth(components.betterAuth, {
  emailAndPassword: false,
  // The function form: the env vars are not set on the first push.
  oidc: () => ({
    issuer: required('OIDC_ISSUER'),
    clientId: required('OIDC_CLIENT_ID'),
    clientSecret: required('OIDC_CLIENT_SECRET'),
  }),
})

export const { ensureSigningKey, pruneSigningKeys, rotateSigningKey } = auth.jwksOperatorFunctions()
