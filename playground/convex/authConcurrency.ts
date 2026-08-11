import { createFunctionHandle, makeFunctionReference } from 'convex/server'
import { v } from 'convex/values'

import { components } from './_generated/api'
import { internalAction, internalMutation, internalQuery } from './_generated/server'

const rowArgs = {
  id: v.string(),
  key: v.string(),
}

/** Test-only playground seam for real-backend adapter race evidence. */
export const createRaceRow = internalMutation({
  args: rowArgs,
  handler: (ctx, args) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      model: 'rateLimit',
      data: { id: args.id, key: args.key, count: 0, lastRequest: 0 },
    }),
})

export const consumeRaceRow = internalMutation({
  args: { id: v.string() },
  handler: (ctx, args) =>
    ctx.runMutation(components.betterAuth.adapter.consumeOne, {
      model: 'rateLimit',
      where: [{ field: 'id', value: args.id }],
    }),
})

export const incrementRaceRow = internalMutation({
  args: { id: v.string() },
  handler: (ctx, args) =>
    ctx.runMutation(components.betterAuth.adapter.incrementOne, {
      model: 'rateLimit',
      where: [{ field: 'id', value: args.id }],
      increment: { count: 1 },
    }),
})

export const readRaceRow = internalQuery({
  args: { id: v.string() },
  handler: (ctx, args) =>
    ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'rateLimit',
      where: [{ field: 'id', value: args.id }],
    }),
})

export const deleteRaceRow = internalMutation({
  args: { id: v.string() },
  handler: (ctx, args) =>
    ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      model: 'rateLimit',
      where: [{ field: 'id', value: args.id }],
    }),
})

const failCreateTriggerReference = makeFunctionReference<
  'mutation',
  { doc: unknown; model: string },
  never
>('authConcurrency:failCreateTrigger')

const failDeleteTriggerReference = makeFunctionReference<
  'mutation',
  { doc: unknown; model: string },
  never
>('authConcurrency:failDeleteTrigger')

const failUpdateTriggerReference = makeFunctionReference<
  'mutation',
  { model: string; newDoc: unknown; oldDoc: unknown },
  never
>('authConcurrency:failUpdateTrigger')

const updateTriggerFaultIdSuffix = '-update-trigger-fault'

/** Deliberate fault used to prove a component write and its app trigger roll back together. */
export const failCreateTrigger = internalMutation({
  args: { doc: v.any(), model: v.string() },
  handler: () => {
    throw new Error('AUTH_TRIGGER_FAULT_INJECTED')
  },
})

export const failDeleteTrigger = internalMutation({
  args: { doc: v.any(), model: v.string() },
  handler: () => {
    throw new Error('AUTH_TRIGGER_FAULT_INJECTED')
  },
})

export const failUpdateTrigger = internalMutation({
  args: { model: v.string(), newDoc: v.any(), oldDoc: v.any() },
  handler: (_ctx, args) => {
    const newDoc = args.newDoc
    if (
      typeof newDoc === 'object' &&
      newDoc !== null &&
      'id' in newDoc &&
      typeof newDoc.id === 'string' &&
      newDoc.id.endsWith(updateTriggerFaultIdSuffix)
    ) {
      throw new Error('AUTH_TRIGGER_FAULT_INJECTED')
    }
  },
})

/** Admin-only test wrapper around the component mutation's trigger-handle seam. */
export const createRaceRowWithFailingTrigger = internalMutation({
  args: rowArgs,
  handler: async (ctx, args) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      model: 'rateLimit',
      data: { id: args.id, key: args.key, count: 0, lastRequest: 0 },
      onCreateHandle: String(await createFunctionHandle(failCreateTriggerReference)),
    }),
})

export const consumeRaceRowWithFailingTrigger = internalMutation({
  args: { id: v.string() },
  handler: async (ctx, args) =>
    ctx.runMutation(components.betterAuth.adapter.consumeOne, {
      model: 'rateLimit',
      where: [{ field: 'id', value: args.id }],
      onDeleteHandle: String(await createFunctionHandle(failDeleteTriggerReference)),
      onDeleteModels: ['rateLimit'],
    }),
})

export const incrementRaceRowWithFailingTrigger = internalMutation({
  args: { id: v.string() },
  handler: async (ctx, args) =>
    ctx.runMutation(components.betterAuth.adapter.incrementOne, {
      model: 'rateLimit',
      where: [{ field: 'id', value: args.id }],
      increment: { count: 1 },
      onUpdateHandle: String(await createFunctionHandle(failUpdateTriggerReference)),
    }),
})

export const updateRaceRowsWithFailingTrigger = internalMutation({
  args: { keyPrefix: v.string() },
  handler: async (ctx, args) =>
    ctx.runMutation(components.betterAuth.adapter.updateMany, {
      model: 'rateLimit',
      where: [{ field: 'key', operator: 'starts_with', value: args.keyPrefix }],
      update: { count: 99 },
      onUpdateHandle: String(await createFunctionHandle(failUpdateTriggerReference)),
    }),
})

const rotateSigningKeyReference = makeFunctionReference<
  'action',
  Record<string, never>,
  {
    createdAt: number
    newKid: string
    previousKids: string[]
    previousVerifyUntil: number
    rotatedAt: number
  }
>('auth:rotateSigningKey')

/** Admin-only test wrapper; production invokes the internal action from deployment tooling. */
export const rotateSigningKeyRace = internalAction({
  args: {},
  handler: (ctx) => ctx.runAction(rotateSigningKeyReference, {}),
})

/** Admin-only metadata with no encoded public key or encrypted private material. */
export const readJwksRaceState = internalQuery({
  args: {},
  handler: async (ctx) => {
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'jwks',
      paginationOpts: { cursor: null, numItems: 100 },
    })
    return (result.page as Array<Record<string, unknown>>).map((row) => ({
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      id: row.id,
    }))
  },
})

/** Removal trigger evidence for the narrow OAuth Provider URL.canParse capability fill. */
export const readRuntimeCapabilities = internalQuery({
  args: {},
  handler: () => ({ urlCanParse: typeof URL.canParse }),
})
