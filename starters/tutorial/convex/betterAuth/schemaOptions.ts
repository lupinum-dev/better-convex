import type { BetterAuthOptions } from 'better-auth'

import { createAuthSchemaPlugins } from './schemaPlugins'

const origin = 'https://schema.invalid'
export default {
  basePath: '/api/auth',
  baseURL: origin,
  plugins: createAuthSchemaPlugins(`${origin}/api/auth`),
  rateLimit: { enabled: true, modelName: 'rateLimit', storage: 'database' },
  secret: 'schema-generation-only-value-never-used-at-runtime',
  verification: { storeIdentifier: 'hashed' },
} satisfies BetterAuthOptions
