import { oauthProvider, type OAuthOptions } from '@better-auth/oauth-provider'
import type { BetterAuthOptions } from 'better-auth'
import { jwt } from 'better-auth/plugins'

const schemaGenerationEnvironment = {
  baseURL: 'https://schema.invalid',
  secret: 'schema-generation-only-value-never-used-at-runtime',
} as const

export const schemaOAuthOptions = {
  accessTokenExpiresIn: 600,
  allowDynamicClientRegistration: false,
  allowUnauthenticatedClientRegistration: false,
  clientPrivileges: () => false,
  codeExpiresIn: 120,
  consentPage: '/oauth/consent',
  customAccessTokenClaims: () => ({ token_use: 'oauth-access' }),
  dpop: { signingAlgorithms: [] },
  enforcePerClientResources: true,
  grantTypes: ['authorization_code'],
  loginPage: '/login',
  rateLimit: {
    authorize: { max: 30, window: 60 },
    revoke: { max: 30, window: 60 },
    token: { max: 20, window: 60 },
  },
  resourcePrivileges: () => false,
  scopes: ['mcp:read', 'mcp:write'],
  storeClientSecret: 'hashed',
  storeTokens: 'hashed',
} satisfies OAuthOptions<['mcp:read', 'mcp:write']>

const schemaAuthOptions = {
  ...schemaGenerationEnvironment,
  account: { encryptOAuthTokens: true },
  basePath: '/api/auth',
  plugins: [
    jwt({
      disableSettingJwtHeader: true,
      jwks: {
        disablePrivateKeyEncryption: false,
        gracePeriod: 21 * 60,
        keyPairConfig: { alg: 'RS256' },
      },
      jwt: {
        audience: 'https://schema.invalid/api/auth',
        expirationTime: '10m',
        issuer: 'https://schema.invalid/api/auth',
      },
    }),
    oauthProvider(schemaOAuthOptions),
  ],
  rateLimit: {
    enabled: true,
    modelName: 'rateLimit',
    storage: 'database',
  },
  verification: { storeIdentifier: 'hashed' },
} satisfies BetterAuthOptions

export default schemaAuthOptions
