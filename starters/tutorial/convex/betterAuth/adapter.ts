import { defineAuthAdapterFunctions } from '@lupinum/better-convex-nuxt/better-auth/server'

import schema from './schema'
import schemaMetadata from './schemaMetadata'

// This module is inside the isolated betterAuth component, not the public app API.
export const { consumeOne, consumeRateLimit, count, create, deleteMany, deleteOne, expireSession, expireVerification, findMany, findOne, incrementOne, oauthLiveAccess, pruneRateLimits, pruneSigningKeys, rotateSigningKey, sessionAdmission, updateMany, updateOne } = defineAuthAdapterFunctions({ metadata: schemaMetadata, schema })
