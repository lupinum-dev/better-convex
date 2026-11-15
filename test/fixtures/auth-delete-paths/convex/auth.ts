import type { AuthContext } from 'better-auth'
import {
  componentsGeneric,
  type FunctionReference,
  type GenericDataModel,
  type GenericMutationCtx,
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
} from 'convex/server'
import { v } from 'convex/values'

import type { ComponentApi } from '../../../../src/runtime/convex-auth/component/_generated/component'
import type { AuthFunctions } from '../../../../src/runtime/convex-auth/types'
import { createBetterConvexAuth } from '../../../helpers/real-auth'

const components = componentsGeneric() as unknown as {
  sessionAuth: ComponentApi<'sessionAuth'>
}
// Codegen would type these as internal references; the fixture has no codegen.
const internalMutation = (name: string) =>
  makeFunctionReference<'mutation'>(name) as unknown as FunctionReference<'mutation', 'internal'>
const authFunctions: AuthFunctions = {
  onCreate: internalMutation('auth:onCreate'),
  onUpdate: internalMutation('auth:onUpdate'),
  onDelete: internalMutation('auth:onDelete'),
}

// The app's own trigger: what the user projection's erasure hangs on.
const auth = createBetterConvexAuth(components.sessionAuth, {
  authFunctions,
  triggers: {
    user: {
      onDelete: async (ctx: GenericMutationCtx<GenericDataModel>, user: { id: unknown }) => {
        await ctx.db.insert('deletedAuthUsers', { authUserId: String(user.id) })
      },
    },
  },
} as never)

export const { onCreate, onUpdate, onDelete } = auth.triggerFunctions()

/** The guest recipe's old path: the component mutation, called without a trigger handle. */
export const deleteThroughComponent = mutationGeneric({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    await ctx.runMutation(components.sessionAuth.adapter.deleteOne, {
      model: 'user',
      where: [{ field: 'id', value: args.id }],
    })
  },
})

/** The documented path: Better Auth's own user deletion, through the library adapter. */
export const deleteThroughBetterAuth = mutationGeneric({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const authInstance = await auth.createAuth(ctx)
    const context = (await authInstance.$context) as AuthContext
    await context.internalAdapter.deleteUser(args.id)
  },
})

export const deletedAuthUsers = queryGeneric({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('deletedAuthUsers').collect()).map((row) => String(row.authUserId)),
})
