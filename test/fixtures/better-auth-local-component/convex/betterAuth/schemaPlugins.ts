import { apiKey } from '@better-auth/api-key'
import { admin, jwt, organization } from 'better-auth/plugins'

/**
 * The schema-changing plugin list is shared by schema generation and runtime
 * configuration so the local component cannot silently drift from Better Auth.
 */
export function createLocalAuthPlugins(authIssuer: string) {
  return [
    admin(),
    organization(),
    apiKey(),
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
