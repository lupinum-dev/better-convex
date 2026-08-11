import { jwt, twoFactor } from 'better-auth/plugins'

/** Shared by runtime configuration and deterministic local schema generation. */
export function createTwoFactorAuthPlugins(authIssuer: string) {
  return [
    twoFactor({
      accountLockout: {
        durationSeconds: 60,
        maxFailedAttempts: 3,
      },
      issuer: 'Better Convex Nuxt MFA Fixture',
    }),
    jwt({
      disableSettingJwtHeader: true,
      jwks: {
        disablePrivateKeyEncryption: false,
        gracePeriod: 21 * 60,
        keyPairConfig: { alg: 'RS256' },
      },
      jwt: {
        audience: authIssuer,
        expirationTime: '10m',
        issuer: authIssuer,
      },
    }),
  ]
}
