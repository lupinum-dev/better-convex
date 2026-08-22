/*
 * Adapted from get-convex/better-auth at
 * c628916b451a6b4cff0f5464f134475464b1a6da (Apache-2.0).
 * All race-sensitive reads and writes stay in the same Convex mutation.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the component is generated from a dynamic schema */
import {
  mutationGeneric,
  paginationOptsValidator,
  queryGeneric,
  type FunctionHandle,
  type SchemaDefinition,
} from 'convex/server'
import { v } from 'convex/values'

import {
  JWKS_GRACE_PERIOD_SECONDS,
  normalizeSigningKeyCandidate,
  signingKeyCandidateValidator,
} from '../jwks-rotation'
import type { AuthFieldMetadata, AuthSchemaMetadata } from './metadata'
import {
  assertAuthSchemaMatchesMetadata,
  getAuthFieldMetadata,
  getAuthModelMetadata,
} from './metadata'
import {
  collectAuthRows,
  countAuthRows,
  findAuthRows,
  paginateAuthRows,
  toBetterAuthDocument,
  type AuthReadArgs,
  type AuthWhere,
} from './query'
import { createAuthRelationshipEngine } from './relationships'

const whereValidator = v.object({
  field: v.string(),
  operator: v.optional(
    v.union(
      v.literal('lt'),
      v.literal('lte'),
      v.literal('gt'),
      v.literal('gte'),
      v.literal('eq'),
      v.literal('in'),
      v.literal('not_in'),
      v.literal('ne'),
      v.literal('contains'),
      v.literal('starts_with'),
      v.literal('ends_with'),
    ),
  ),
  value: v.union(
    v.string(),
    v.number(),
    v.boolean(),
    v.array(v.string()),
    v.array(v.number()),
    v.null(),
  ),
  connector: v.optional(v.union(v.literal('AND'), v.literal('OR'))),
  mode: v.optional(v.union(v.literal('sensitive'), v.literal('insensitive'))),
})

const readArgs = {
  model: v.string(),
  where: v.optional(v.array(whereValidator)),
  select: v.optional(v.array(v.string())),
  sortBy: v.optional(
    v.object({
      field: v.string(),
      direction: v.union(v.literal('asc'), v.literal('desc')),
    }),
  ),
  offset: v.optional(v.number()),
}

export interface DefineAuthAdapterFunctionsOptions<Schema extends SchemaDefinition<any, any>> {
  schema: Schema
  metadata: AuthSchemaMetadata
}

function assertRecord(value: unknown, code: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code)
}

function assertValue(field: AuthFieldMetadata, value: unknown): void {
  if (value === null) {
    if (!field.nullable) throw new Error(`AUTH_FIELD_NULL_FORBIDDEN:${field.physicalName}`)
    return
  }
  switch (field.kind) {
    case 'string':
    case 'json':
      if (typeof value !== 'string') throw new Error(`AUTH_FIELD_TYPE:${field.physicalName}`)
      return
    case 'number':
    case 'date':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`AUTH_FIELD_TYPE:${field.physicalName}`)
      }
      return
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error(`AUTH_FIELD_TYPE:${field.physicalName}`)
      return
    case 'string[]':
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        throw new Error(`AUTH_FIELD_TYPE:${field.physicalName}`)
      }
      return
    case 'number[]':
      if (
        !Array.isArray(value) ||
        value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))
      ) {
        throw new Error(`AUTH_FIELD_TYPE:${field.physicalName}`)
      }
  }
}

function normalizeCreate(
  metadata: AuthSchemaMetadata,
  modelName: string,
  input: unknown,
): Record<string, unknown> {
  assertRecord(input, 'AUTH_CREATE_DATA_INVALID')
  const model = getAuthModelMetadata(metadata, modelName)
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(input)) getAuthFieldMetadata(metadata, modelName, key)
  for (const field of Object.values(model.fields)) {
    const value = input[field.physicalName]
    if (value === undefined) {
      if (field.nullable) {
        result[field.physicalName] = null
        continue
      }
      throw new Error(`AUTH_FIELD_REQUIRED:${modelName}.${field.physicalName}`)
    }
    assertValue(field, value)
    result[field.physicalName] = value
  }
  if (typeof result.id !== 'string' || result.id.length === 0) {
    throw new Error(`AUTH_LOGICAL_ID_REQUIRED:${modelName}`)
  }
  return result
}

function normalizeUpdate(
  metadata: AuthSchemaMetadata,
  modelName: string,
  input: unknown,
  options: { allowEmpty?: boolean; allowUnique: boolean },
): Record<string, unknown> {
  assertRecord(input, 'AUTH_UPDATE_DATA_INVALID')
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    const field = getAuthFieldMetadata(metadata, modelName, key)
    if (!field.updatable || field.logicalName === 'id') {
      throw new Error(`AUTH_FIELD_IMMUTABLE:${modelName}.${field.physicalName}`)
    }
    if (!options.allowUnique && field.unique) {
      throw new Error(`AUTH_BULK_UNIQUE_UPDATE_FORBIDDEN:${modelName}.${field.physicalName}`)
    }
    assertValue(field, value)
    result[field.physicalName] = value
  }
  if (!options.allowEmpty && Object.keys(result).length === 0) throw new Error('AUTH_UPDATE_EMPTY')
  return result
}

function readShape(args: Record<string, unknown>): AuthReadArgs {
  return {
    model: args.model as string,
    where: args.where as AuthWhere[] | undefined,
    select: args.select as string[] | undefined,
    sortBy: args.sortBy as AuthReadArgs['sortBy'],
    offset: args.offset as number | undefined,
  }
}

async function assertUniqueConstraints(
  ctx: any,
  schema: SchemaDefinition<any, any>,
  metadata: AuthSchemaMetadata,
  modelName: string,
  changes: Record<string, unknown>,
  current?: Record<string, unknown>,
): Promise<void> {
  const model = getAuthModelMetadata(metadata, modelName)
  const data = current ? { ...current, ...changes } : changes
  for (const index of model.indexes) {
    if (index.unique !== true) continue
    if (current && index.fields.every((fieldName) => !(fieldName in changes))) continue
    const where: AuthWhere[] = []
    let complete = true
    for (const fieldName of index.fields) {
      const value = data[fieldName]
      if (value === null || value === undefined) {
        complete = false
        break
      }
      where.push({ field: fieldName, operator: 'eq', value: value as never })
    }
    if (!complete) continue
    const matches = await findAuthRows(
      ctx,
      schema,
      metadata,
      {
        model: modelName,
        where,
      },
      2,
    )
    if (matches.some((row) => row._id !== current?._id)) {
      throw new Error(`AUTH_UNIQUE_CONFLICT:${modelName}.${index.descriptor}`)
    }
  }
}

function assertBulkUniqueConstraints(
  metadata: AuthSchemaMetadata,
  modelName: string,
  patch: Record<string, unknown>,
  rows: readonly Record<string, unknown>[],
): void {
  const model = getAuthModelMetadata(metadata, modelName)
  for (const index of model.indexes) {
    if (index.unique !== true || !index.fields.some((field) => field in patch)) continue
    const seen = new Set<string>()
    for (const current of rows) {
      const candidate = { ...current, ...patch }
      const values = index.fields.map((field) => candidate[field])
      if (values.some((value) => value === null || value === undefined)) continue
      const key = JSON.stringify(values)
      if (seen.has(key)) throw new Error(`AUTH_UNIQUE_CONFLICT:${modelName}.${index.descriptor}`)
      seen.add(key)
    }
  }
}

async function runTrigger(
  ctx: any,
  handle: string | undefined,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!handle) return
  await ctx.runMutation(handle as unknown as FunctionHandle<'mutation'>, payload)
}

function oneOrNull(
  rows: Record<string, unknown>[],
  operation: string,
): Record<string, unknown> | null {
  if (rows.length === 0) return null
  if (rows.length > 1) throw new Error(`${operation}_MATCHED_MULTIPLE_ROWS`)
  return rows[0] ?? null
}

export function defineAuthAdapterFunctions<Schema extends SchemaDefinition<any, any>>({
  schema,
  metadata,
}: DefineAuthAdapterFunctionsOptions<Schema>) {
  assertAuthSchemaMatchesMetadata(schema, metadata)
  const relationships = createAuthRelationshipEngine({ schema, metadata, runTrigger })
  return {
    create: mutationGeneric({
      args: {
        model: v.string(),
        data: v.any(),
        onCreateHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        const row = normalizeCreate(metadata, args.model, args.data)
        await relationships.assertTargets(ctx, args.model, row)
        await assertUniqueConstraints(ctx, schema, metadata, args.model, row)
        const storageId = await ctx.db.insert(args.model as never, row as never)
        const created = await ctx.db.get(args.model as never, storageId as never)
        if (!created) throw new Error('AUTH_CREATE_READBACK_FAILED')
        await runTrigger(ctx, args.onCreateHandle, {
          model: args.model,
          doc: toBetterAuthDocument(created as never),
        })
        const finalRow = await ctx.db.get(args.model as never, storageId as never)
        if (!finalRow) throw new Error('AUTH_CREATE_TRIGGER_DELETED_ROW')
        return toBetterAuthDocument(finalRow as never)
      },
    }),

    findOne: queryGeneric({
      args: { ...readArgs, join: v.optional(v.any()) },
      handler: async (ctx, args) => {
        const rows = await findAuthRows(ctx, schema, metadata, readShape(args), 2)
        return toBetterAuthDocument(oneOrNull(rows, 'AUTH_FIND_ONE'), args.select)
      },
    }),

    findMany: queryGeneric({
      args: {
        ...readArgs,
        join: v.optional(v.any()),
        limit: v.optional(v.number()),
        paginationOpts: paginationOptsValidator,
      },
      handler: async (ctx, args) => {
        const result = await paginateAuthRows(
          ctx,
          schema,
          metadata,
          readShape(args),
          args.paginationOpts,
        )
        return args.limit === undefined
          ? result
          : { ...result, page: result.page.slice(0, args.limit) }
      },
    }),

    count: queryGeneric({
      args: { model: v.string(), where: v.optional(v.array(whereValidator)) },
      handler: (ctx, args) => countAuthRows(ctx, schema, metadata, readShape(args)),
    }),

    updateOne: mutationGeneric({
      args: {
        model: v.string(),
        where: v.array(whereValidator),
        update: v.any(),
        onUpdateHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        if (args.where.length === 0) return null
        const patch = normalizeUpdate(metadata, args.model, args.update, {
          allowUnique: true,
        })
        const current = oneOrNull(
          await findAuthRows(ctx, schema, metadata, readShape(args), 2),
          'AUTH_UPDATE_ONE',
        )
        if (!current) return null
        await relationships.assertTargets(
          ctx,
          args.model,
          { ...current, ...patch },
          new Set(Object.keys(patch)),
        )
        await assertUniqueConstraints(ctx, schema, metadata, args.model, patch, current)
        await ctx.db.patch(args.model as never, current._id as never, patch as never)
        const updated = await ctx.db.get(args.model as never, current._id as never)
        if (!updated) throw new Error('AUTH_UPDATE_READBACK_FAILED')
        await runTrigger(ctx, args.onUpdateHandle, {
          model: args.model,
          oldDoc: toBetterAuthDocument(current),
          newDoc: toBetterAuthDocument(updated as never),
        })
        const finalRow = await ctx.db.get(args.model as never, current._id as never)
        if (!finalRow) throw new Error('AUTH_UPDATE_TRIGGER_DELETED_ROW')
        return toBetterAuthDocument(finalRow as never)
      },
    }),

    updateMany: mutationGeneric({
      args: {
        model: v.string(),
        where: v.array(whereValidator),
        update: v.any(),
        onUpdateHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        const patch = normalizeUpdate(metadata, args.model, args.update, {
          allowUnique: false,
        })
        const rows = await relationships.collectOperationRows(ctx, readShape(args))
        assertBulkUniqueConstraints(metadata, args.model, patch, rows)
        for (const current of rows) {
          await relationships.assertTargets(
            ctx,
            args.model,
            { ...current, ...patch },
            new Set(Object.keys(patch)),
          )
          await assertUniqueConstraints(ctx, schema, metadata, args.model, patch, current)
        }
        for (const current of rows) {
          await ctx.db.patch(args.model as never, current._id as never, patch as never)
          if (!args.onUpdateHandle) continue
          const updated = await ctx.db.get(args.model as never, current._id as never)
          if (!updated) throw new Error('AUTH_BULK_UPDATE_READBACK_FAILED')
          await runTrigger(ctx, args.onUpdateHandle, {
            model: args.model,
            oldDoc: toBetterAuthDocument(current),
            newDoc: toBetterAuthDocument(updated as never),
          })
        }
        return rows.length
      },
    }),

    deleteOne: mutationGeneric({
      args: {
        model: v.string(),
        where: v.array(whereValidator),
        onDeleteHandle: v.optional(v.string()),
        onDeleteModels: v.optional(v.array(v.string())),
        onUpdateHandle: v.optional(v.string()),
        onUpdateModels: v.optional(v.array(v.string())),
      },
      handler: async (ctx, args) => {
        const current = oneOrNull(
          await findAuthRows(ctx, schema, metadata, readShape(args), 2),
          'AUTH_DELETE_ONE',
        )
        if (!current) return null
        await relationships.applyDeletion(ctx, [current], args.model, args)
        return toBetterAuthDocument(current)
      },
    }),

    deleteMany: mutationGeneric({
      args: {
        model: v.string(),
        where: v.array(whereValidator),
        onDeleteHandle: v.optional(v.string()),
        onDeleteModels: v.optional(v.array(v.string())),
        onUpdateHandle: v.optional(v.string()),
        onUpdateModels: v.optional(v.array(v.string())),
      },
      handler: async (ctx, args) => {
        const rows = await relationships.collectOperationRows(ctx, readShape(args))
        await relationships.applyDeletion(ctx, rows, args.model, args)
        return rows.length
      },
    }),

    consumeOne: mutationGeneric({
      args: {
        model: v.string(),
        where: v.array(whereValidator),
        onDeleteHandle: v.optional(v.string()),
        onDeleteModels: v.optional(v.array(v.string())),
        onUpdateHandle: v.optional(v.string()),
        onUpdateModels: v.optional(v.array(v.string())),
      },
      handler: async (ctx, args) => {
        if (args.where.length === 0) throw new Error('AUTH_CONSUME_REQUIRES_GUARD')
        const current = oneOrNull(
          await findAuthRows(ctx, schema, metadata, readShape(args), 2),
          'AUTH_CONSUME_ONE',
        )
        if (!current) return null
        await relationships.applyDeletion(ctx, [current], args.model, args)
        return toBetterAuthDocument(current)
      },
    }),

    incrementOne: mutationGeneric({
      args: {
        model: v.string(),
        where: v.array(whereValidator),
        increment: v.any(),
        set: v.optional(v.any()),
        onUpdateHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        assertRecord(args.increment, 'AUTH_INCREMENT_INVALID')
        assertRecord(args.set ?? {}, 'AUTH_INCREMENT_SET_INVALID')
        const incrementEntries = Object.entries(args.increment)
        const set = normalizeUpdate(metadata, args.model, args.set ?? {}, {
          allowEmpty: true,
          allowUnique: false,
        })
        if (incrementEntries.length === 0 && Object.keys(set).length === 0) {
          throw new Error('AUTH_INCREMENT_EMPTY')
        }
        for (const [fieldName, delta] of incrementEntries) {
          if (fieldName in set) throw new Error(`AUTH_INCREMENT_SET_OVERLAP:${fieldName}`)
          const field = getAuthFieldMetadata(metadata, args.model, fieldName)
          if (field.kind !== 'number' || field.unique || !field.updatable) {
            throw new Error(`AUTH_INCREMENT_FIELD_INVALID:${args.model}.${fieldName}`)
          }
          if (typeof delta !== 'number' || !Number.isFinite(delta)) {
            throw new TypeError(`AUTH_INCREMENT_DELTA_INVALID:${fieldName}`)
          }
        }
        const current = oneOrNull(
          await findAuthRows(ctx, schema, metadata, readShape(args), 2),
          'AUTH_INCREMENT_ONE',
        )
        if (!current) return null
        const patch: Record<string, unknown> = { ...set }
        for (const [fieldName, delta] of incrementEntries) {
          const value = current[fieldName]
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new TypeError(`AUTH_INCREMENT_CURRENT_INVALID:${fieldName}`)
          }
          const next = value + (delta as number)
          if (!Number.isFinite(next)) throw new Error(`AUTH_INCREMENT_OVERFLOW:${fieldName}`)
          patch[fieldName] = next
        }
        await assertUniqueConstraints(ctx, schema, metadata, args.model, patch, current)
        await relationships.assertTargets(
          ctx,
          args.model,
          { ...current, ...patch },
          new Set(Object.keys(patch)),
        )
        await ctx.db.patch(args.model as never, current._id as never, patch as never)
        const updated = await ctx.db.get(args.model as never, current._id as never)
        if (!updated) throw new Error('AUTH_INCREMENT_READBACK_FAILED')
        await runTrigger(ctx, args.onUpdateHandle, {
          model: args.model,
          oldDoc: toBetterAuthDocument(current),
          newDoc: toBetterAuthDocument(updated as never),
        })
        return toBetterAuthDocument(updated as never)
      },
    }),

    rotateSigningKey: mutationGeneric({
      args: { next: signingKeyCandidateValidator, onlyIfEmpty: v.optional(v.boolean()) },
      handler: async (ctx, args) => {
        const next = normalizeSigningKeyCandidate(args.next)
        const rotationNow = Date.now()
        const rows = await collectAuthRows(ctx, schema, metadata, { model: 'jwks' }, 10_000)
        const keysCurrentAtCommit = rows
          .filter((row) => {
            const expiresAt = row.expiresAt
            return expiresAt === null || (typeof expiresAt === 'number' && expiresAt > rotationNow)
          })
          .sort((left, right) => {
            const byCreatedAt = Number(left.createdAt) - Number(right.createdAt)
            return byCreatedAt || String(left.id).localeCompare(String(right.id))
          })
        if (args.onlyIfEmpty && keysCurrentAtCommit.length > 0) {
          const current = keysCurrentAtCommit.at(-1)!
          return {
            created: false,
            createdAt: Number(current.createdAt),
            newKid: String(current.id),
            previousKids: [],
            previousVerifyUntil: rotationNow + JWKS_GRACE_PERIOD_SECONDS * 1_000,
            rotatedAt: rotationNow,
          }
        }
        if (rows.some((row) => row.id === next.id)) {
          throw new Error('AUTH_UNIQUE_CONFLICT:jwks.id')
        }
        const latestCreatedAt = rows.reduce((latest, row) => {
          if (typeof row.createdAt !== 'number' || !Number.isSafeInteger(row.createdAt)) {
            throw new TypeError('AUTH_JWKS_CREATED_AT_INVALID')
          }
          return Math.max(latest, row.createdAt)
        }, rotationNow - 1)
        if (latestCreatedAt >= Number.MAX_SAFE_INTEGER) {
          throw new Error('AUTH_JWKS_CREATED_AT_INVALID')
        }
        const createdAt = Math.max(rotationNow, latestCreatedAt + 1)

        await ctx.db.insert(
          'jwks' as never,
          {
            ...next,
            createdAt,
            expiresAt: null,
          } as never,
        )
        for (const previous of keysCurrentAtCommit) {
          await ctx.db.patch(previous._id as never, { expiresAt: rotationNow } as never)
        }

        return {
          ...(args.onlyIfEmpty ? { created: true } : {}),
          createdAt,
          newKid: next.id,
          previousKids: keysCurrentAtCommit.map((key) => String(key.id)),
          previousVerifyUntil: rotationNow + JWKS_GRACE_PERIOD_SECONDS * 1_000,
          rotatedAt: rotationNow,
        }
      },
    }),
  }
}
