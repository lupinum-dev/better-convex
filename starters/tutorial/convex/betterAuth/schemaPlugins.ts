import { jwt } from 'better-auth/plugins'

// Plugins that add tables, such as organization() or twoFactor(), go here and in convex/auth.ts.
// Regenerate the schema after a change: pnpm exec better-convex-nuxt auth schema
export function createAuthSchemaPlugins(authIssuer: string) {
  return [
    jwt({
      disableSettingJwtHeader: true,
      jwks: { disablePrivateKeyEncryption: false, gracePeriod: 21 * 60, keyPairConfig: { alg: 'RS256' } },
      jwt: { audience: authIssuer, expirationTime: '10m', issuer: authIssuer },
    }),
  ]
}
