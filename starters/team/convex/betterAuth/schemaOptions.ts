import type { BetterAuthOptions } from 'better-auth'

import { createTeamAuthPlugins } from './schemaPlugins'

const schemaOrigin = 'https://schema.invalid'

const schemaAuthOptions = {
  basePath: '/api/auth',
  baseURL: schemaOrigin,
  plugins: createTeamAuthPlugins(`${schemaOrigin}/api/auth`),
  rateLimit: { enabled: true, modelName: 'rateLimit', storage: 'database' },
  secret: 'schema-generation-only-value-never-used-at-runtime',
  verification: { storeIdentifier: 'hashed' },
} satisfies BetterAuthOptions

export default schemaAuthOptions
