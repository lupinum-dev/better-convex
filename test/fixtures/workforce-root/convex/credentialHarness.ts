import {
  componentsGeneric,
  createFunctionHandle,
  internalMutationGeneric,
  makeFunctionReference,
  type GenericDataModel,
  type GenericMutationCtx,
} from 'convex/server'
import { v } from 'convex/values'

import type { ComponentApi } from '../../../../src/runtime/convex-auth/component/_generated/component'

const components = componentsGeneric() as unknown as {
  workforceAuth: ComponentApi<'workforceAuth'>
}
const auth = components.workforceAuth.adapter
const where = [{ field: 'id', value: 'password' }]
const document = v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()))

async function rejectAfterWrite(
  ctx: GenericMutationCtx<GenericDataModel>,
  generation: number,
  password: string | null,
): Promise<never> {
  const owner = await ctx.runQuery(auth.findOne, {
    model: 'user',
    where: [{ field: 'id', value: 'user' }],
  })
  const credential = await ctx.runQuery(auth.findOne, { model: 'account', where })
  if (
    owner?.bcnSecurityGeneration !== generation ||
    (password === null ? credential !== null : credential?.password !== password)
  ) {
    throw new Error('AUTH_WORKFORCE_TRIGGER_BEFORE_WRITE')
  }
  throw new Error('AUTH_WORKFORCE_TRIGGER_FAULT_INJECTED')
}

export const rejectCreate = internalMutationGeneric({
  args: { model: v.literal('account'), doc: document },
  returns: v.null(),
  handler: (ctx) => rejectAfterWrite(ctx, 1, 'hash-created'),
})

export const rejectUpdate = internalMutationGeneric({
  args: { model: v.literal('account'), oldDoc: document, newDoc: document },
  returns: v.null(),
  handler: (ctx) => rejectAfterWrite(ctx, 2, 'hash-reset'),
})

export const rejectDelete = internalMutationGeneric({
  args: { model: v.literal('account'), doc: document },
  returns: v.null(),
  handler: (ctx) => rejectAfterWrite(ctx, 2, null),
})

export const createWithRejectingTrigger = internalMutationGeneric({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runMutation(auth.create, {
      model: 'account',
      data: {
        id: 'password',
        issuer: 'credential',
        accountId: 'password',
        providerId: 'credential',
        userId: 'user',
        password: 'hash-created',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      },
      onCreateHandle: String(
        await createFunctionHandle(
          makeFunctionReference<'mutation'>('credentialHarness:rejectCreate'),
        ),
      ),
    })
    return null
  },
})

export const updateWithRejectingTrigger = internalMutationGeneric({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runMutation(auth.updateOne, {
      model: 'account',
      where,
      update: { password: 'hash-reset' },
      onUpdateHandle: String(
        await createFunctionHandle(
          makeFunctionReference<'mutation'>('credentialHarness:rejectUpdate'),
        ),
      ),
    })
    return null
  },
})

export const deleteWithRejectingTrigger = internalMutationGeneric({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runMutation(auth.deleteOne, {
      model: 'account',
      where,
      onDeleteModels: ['account'],
      onDeleteHandle: String(
        await createFunctionHandle(
          makeFunctionReference<'mutation'>('credentialHarness:rejectDelete'),
        ),
      ),
    })
    return null
  },
})
