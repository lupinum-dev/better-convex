import {
  componentsGeneric,
  createFunctionHandle,
  type FunctionReference,
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
} from 'convex/server'
import { v } from 'convex/values'

import type { ComponentApi } from '../../../../src/runtime/convex-auth/component/_generated/component'

const components = componentsGeneric() as unknown as {
  relationshipPolicies: ComponentApi<'relationshipPolicies'>
}

const onDelete = makeFunctionReference<'mutation'>('relationshipTriggers:onDelete')
const onUpdate = makeFunctionReference<'mutation'>('relationshipTriggers:onUpdate')
const deleteOneWithTriggerModels = components.relationshipPolicies.adapter
  .deleteOne as FunctionReference<
  'mutation',
  'internal',
  {
    model: string
    onDeleteHandle?: string
    onDeleteModels?: string[]
    onUpdateHandle?: string
    onUpdateModels?: string[]
    where: Array<{ field: string; value: string }>
  },
  Record<string, unknown> | null
>

export const deleteWithTriggers = mutationGeneric({
  args: { id: v.string(), model: v.string() },
  handler: async (ctx, args) =>
    ctx.runMutation(deleteOneWithTriggerModels, {
      model: args.model,
      where: [{ field: 'id', value: args.id }],
      onDeleteHandle: String(await createFunctionHandle(onDelete)),
      onDeleteModels: ['cascadeChild', 'node', 'nullableChild', 'parent', 'restrictChild'],
      onUpdateHandle: String(await createFunctionHandle(onUpdate)),
      onUpdateModels: ['cascadeChild', 'node', 'nullableChild', 'parent', 'restrictChild'],
    }),
})

export const deleteWithParentTriggerOnly = mutationGeneric({
  args: { id: v.string(), model: v.string() },
  handler: async (ctx, args) => {
    const result = await ctx.runMutation(deleteOneWithTriggerModels, {
      model: args.model,
      where: [{ field: 'id', value: args.id }],
      onDeleteHandle: String(await createFunctionHandle(onDelete)),
      onDeleteModels: ['parent'],
      onUpdateHandle: String(await createFunctionHandle(onUpdate)),
      onUpdateModels: [],
    })
    return { metrics: await ctx.meta.getTransactionMetrics(), result }
  },
})

export const listEvents = queryGeneric({
  args: {},
  handler: (ctx) => ctx.db.query('relationshipEvents').collect(),
})
