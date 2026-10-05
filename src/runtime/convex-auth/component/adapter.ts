import { defineAuthAdapterFunctions } from '../adapter/define-functions'
import schema from './schema'
import schemaMetadata from './schemaMetadata'

export const {
  consumeOne,
  consumeRateLimit,
  count,
  create,
  deleteMany,
  deleteOne,
  expireSession,
  findMany,
  findOne,
  incrementOne,
  oauthLiveAccess,
  pruneRateLimits,
  pruneSigningKeys,
  rotateSigningKey,
  sessionAdmission,
  updateMany,
  updateOne,
} = defineAuthAdapterFunctions({ metadata: schemaMetadata, schema })
