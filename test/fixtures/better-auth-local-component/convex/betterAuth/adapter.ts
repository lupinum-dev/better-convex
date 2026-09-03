import { defineAuthAdapterFunctions } from '@lupinum/better-convex-nuxt/better-auth/server'

import schema from './schema'
import schemaMetadata from './schemaMetadata'

export const {
  assertProfile,
  consumeOne,
  count,
  create,
  deleteMany,
  deleteOne,
  findMany,
  findOne,
  incrementOne,
  rotateSigningKey,
  sessionAdmission,
  expireWorkforceSession,
  listWorkforceSessions,
  revokeAllWorkforceSessions,
  revokeWorkforceSession,
  touchWorkforceSession,
  updateMany,
  updateOne,
} = defineAuthAdapterFunctions({ metadata: schemaMetadata, schema })
