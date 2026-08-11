import type { BetterAuthOptions } from 'better-auth'

import { createTwoFactorAuthPlugins } from './schemaPlugins'

export const schemaGenerationEnvironment = {
  baseURL: 'https://schema.invalid',
  secret: 'schema-generation-only-value-never-used-at-runtime',
} as const

const authIssuer = `${schemaGenerationEnvironment.baseURL}/api/auth`

/** Canonical, environment-independent input for the checked-in MFA schema. */
const schemaOptions = {
  account: { encryptOAuthTokens: true },
  basePath: '/api/auth',
  baseURL: schemaGenerationEnvironment.baseURL,
  rateLimit: {
    enabled: true,
    modelName: 'rateLimit',
    storage: 'database',
  },
  secret: schemaGenerationEnvironment.secret,
  verification: { storeIdentifier: 'hashed' },
  plugins: createTwoFactorAuthPlugins(authIssuer),
} satisfies BetterAuthOptions

export default schemaOptions
