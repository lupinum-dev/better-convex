import type { BetterAuthOptions } from 'better-auth'
import { twoFactor } from 'better-auth/plugins'

import { createAuthJwtPlugin } from '../auth-jwt'
import { workforceSchemaOptions, workforceSchemaPlugin } from './schema'

export function createWorkforceSchemaPlugins(): [
  ReturnType<typeof twoFactor>,
  typeof workforceSchemaPlugin,
] {
  return [
    twoFactor({
      allowPasswordless: false,
      skipVerificationOnEnable: false,
      totpOptions: { digits: 6, period: 30 },
    }),
    workforceSchemaPlugin,
  ]
}

/** Build-time only: no environment, delivery callbacks, or runtime credentials. */
export function createWorkforceAuthSchemaOptions(): BetterAuthOptions {
  const baseURL = 'https://schema.invalid'
  return {
    ...workforceSchemaOptions,
    baseURL,
    secret: 'schema-generation-only-value-never-used-at-runtime',
    emailAndPassword: { enabled: true },
    plugins: [...createWorkforceSchemaPlugins(), createAuthJwtPlugin(`${baseURL}/api/auth`)],
    rateLimit: { enabled: true, modelName: 'rateLimit', storage: 'database' },
  } satisfies BetterAuthOptions
}
