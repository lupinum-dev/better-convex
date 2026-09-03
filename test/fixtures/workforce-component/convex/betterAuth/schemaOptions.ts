import type { BetterAuthOptions } from 'better-auth'
import { twoFactor } from 'better-auth/plugins'

import {
  workforceSchemaOptions,
  workforceSchemaPlugin,
} from '../../../../../src/runtime/convex-auth/workforce/schema'

export default {
  ...workforceSchemaOptions,
  baseURL: 'https://schema.invalid',
  secret: 'schema-generation-only-value-never-used-at-runtime',
  plugins: [twoFactor(), workforceSchemaPlugin],
} satisfies BetterAuthOptions
