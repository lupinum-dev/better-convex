import { internalMutationGeneric, internalQueryGeneric } from 'convex/server'
import { v } from 'convex/values'

import {
  expireWorkforceSession,
  listWorkforceSessions,
  revokeAllWorkforceSessions,
  revokeWorkforceSession,
  touchWorkforceSession,
  workforceSessionActorValidator,
  workforceSessionPageOptionsValidator,
  workforceSessionPageValidator,
} from '../../../../../src/runtime/convex-auth/workforce/session-management'
import schema from './schema'
import metadata from './schemaMetadata'

export const touch = internalMutationGeneric({
  args: { actor: workforceSessionActorValidator },
  returns: v.object({ expiresAt: v.number() }),
  handler: (ctx, { actor }) => touchWorkforceSession(ctx, actor),
})

export const list = internalQueryGeneric({
  args: {
    actor: workforceSessionActorValidator,
    paginationOpts: workforceSessionPageOptionsValidator,
  },
  returns: workforceSessionPageValidator,
  handler: (ctx, { actor, paginationOpts }) =>
    listWorkforceSessions(ctx, actor, paginationOpts, { schema, metadata }),
})

export const revoke = internalMutationGeneric({
  args: { actor: workforceSessionActorValidator, targetSessionId: v.string() },
  returns: v.null(),
  handler: (ctx, { actor, targetSessionId }) => revokeWorkforceSession(ctx, actor, targetSessionId),
})

export const revokeAll = internalMutationGeneric({
  args: { actor: workforceSessionActorValidator },
  returns: v.null(),
  handler: (ctx, { actor }) => revokeAllWorkforceSessions(ctx, actor),
})

export const revokeAllThenFail = internalMutationGeneric({
  args: { actor: workforceSessionActorValidator },
  returns: v.null(),
  handler: async (ctx, { actor }) => {
    await revokeAllWorkforceSessions(ctx, actor)
    throw new Error('TEST_SESSION_REVOKE_ROLLBACK')
  },
})

export const expire = internalMutationGeneric({
  args: { storageId: v.id('session') },
  returns: v.union(v.number(), v.null()),
  handler: (ctx, { storageId }) => expireWorkforceSession(ctx, storageId),
})
