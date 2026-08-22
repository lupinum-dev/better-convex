import { defineAuthAdapterFunctions } from '@lupinum/better-convex-nuxt/better-auth/server'

import schema from './schema'
import schemaMetadata from './schemaMetadata'

export const {
  consumeOne,
  count,
  create,
  deleteMany,
  deleteOne,
  findMany,
  findOne,
  incrementOne,
  rotateSigningKey,
  updateMany,
  updateOne,
} = defineAuthAdapterFunctions({ metadata: schemaMetadata, schema })
