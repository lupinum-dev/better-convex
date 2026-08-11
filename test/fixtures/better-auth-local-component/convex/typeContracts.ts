import type {
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
  GenericQueryCtx,
} from 'convex/server'

import type { DataModel } from './_generated/dataModel'
import { authComponent, createAuth } from './auth'
import type schema from './betterAuth/schema'

type Assert<T extends true> = T
type HasTable<T, K extends PropertyKey> = K extends keyof T ? true : false

type BetterAuthDataModel = DataModelFromSchemaDefinition<typeof schema>

type _HasLogicalUserId = Assert<
  'id' extends keyof BetterAuthDataModel['user']['document'] ? true : false
>
type _HasAdminUserFields = Assert<
  'role' extends keyof BetterAuthDataModel['user']['document'] ? true : false
>
type _HasOrganizationTable = Assert<HasTable<BetterAuthDataModel, 'organization'>>
type _HasMemberTable = Assert<HasTable<BetterAuthDataModel, 'member'>>
type _HasInvitationTable = Assert<HasTable<BetterAuthDataModel, 'invitation'>>
type _HasApiKeyTable = Assert<HasTable<BetterAuthDataModel, 'apikey'>>
type _HasJwksTable = Assert<HasTable<BetterAuthDataModel, 'jwks'>>
type _HasRateLimitTable = Assert<HasTable<BetterAuthDataModel, 'rateLimit'>>

export async function assertLocalComponentHelpersCompile(ctx: GenericMutationCtx<DataModel>) {
  const { auth, headers } = await authComponent.getAuth(createAuth, ctx)
  const user = await authComponent.safeGetAuthUser(ctx)

  return { auth, headers, user }
}

export function assertQueryContextUsesReadPath(ctx: GenericQueryCtx<DataModel>) {
  const user = authComponent.safeGetAuthUser(ctx)

  // A query may authenticate through component reads, but it must never create
  // a Better Auth instance whose adapter could write.
  // @ts-expect-error getAuth intentionally requires a mutation or action context.
  const auth = authComponent.getAuth(createAuth, ctx)
  return { auth, user }
}
