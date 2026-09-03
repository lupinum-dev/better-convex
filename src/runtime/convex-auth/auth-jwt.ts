import { jwt } from 'better-auth/plugins'

/** Shared runtime and build-time schema owner for the auth signing keys. */
export function createAuthJwtPlugin(issuer: string): ReturnType<typeof jwt> {
  return jwt({
    disableSettingJwtHeader: true,
    jwks: {
      disablePrivateKeyEncryption: false,
      gracePeriod: 21 * 60,
      keyPairConfig: { alg: 'RS256' },
    },
    jwt: { audience: issuer, expirationTime: '10m', issuer },
  })
}
