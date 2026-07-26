/*
 * Adapted from get-convex/better-auth at
 * c628916b451a6b4cff0f5464f134475464b1a6da (Apache-2.0).
 * Rewritten for first-class logical IDs, native atomic operations, and one
 * component mutation per write.
 */
import {
  createAdapterFactory,
  type CleanedWhere,
  type CustomAdapter,
  type DBAdapterDebugLogOption,
  type JoinConfig,
} from 'better-auth/adapters'
import { symmetricDecrypt, symmetricEncrypt, type SecretConfig } from 'better-auth/crypto'
import { createFunctionHandle, type FunctionArgs, type GenericDataModel } from 'convex/server'

import { isWritableAuthCtx, requireWritableAuthCtx, type AuthCtx } from '../context'
import type { AuthAdapterComponentApi, AuthComponentTriggers, AuthFunctions } from '../types'
import { createAuthSchema } from './generate-schema'

interface AdapterOptions<DataModel extends GenericDataModel> {
  authFunctions?: AuthFunctions
  debugLogs?: DBAdapterDebugLogOption
  triggers?: AuthComponentTriggers<DataModel>
}

interface Page<T> {
  continueCursor: string
  isDone: boolean
  page: T[]
}

type ComponentWhere = NonNullable<
  FunctionArgs<AuthAdapterComponentApi['adapter']['findOne']>['where']
>
type ComponentUpdate = FunctionArgs<AuthAdapterComponentApi['adapter']['updateOne']>['update']

function toComponentWhere(where: CleanedWhere[] | undefined): ComponentWhere | undefined {
  return where?.map((condition) => ({
    ...condition,
    value:
      condition.value instanceof Date
        ? condition.value.getTime()
        : Array.isArray(condition.value)
          ? [...condition.value]
          : condition.value,
  })) as ComponentWhere | undefined
}

interface IdTokenProtectionOptions {
  account?: {
    encryptOAuthTokens?: boolean
    fields?: { idToken?: string }
    modelName?: string
  }
  secrets?: Array<{ value: string; version: number }>
}

const encryptedEnvelopePrefix = '$ba$'

function parseVersionedSecrets(raw: string | undefined): Array<{ value: string; version: number }> {
  if (!raw) return []
  return raw.split(',').map((entry) => {
    const separator = entry.indexOf(':')
    const versionText = separator < 0 ? '' : entry.slice(0, separator).trim()
    const value = separator < 0 ? '' : entry.slice(separator + 1).trim()
    const version = Number(versionText)
    if (
      !/^(?:0|[1-9]\d*)$/u.test(versionText) ||
      !Number.isSafeInteger(version) ||
      value.length === 0
    ) {
      throw new Error('AUTH_VERSIONED_SECRETS_INVALID')
    }
    return { value, version }
  })
}

function idTokenSecretConfig(options: IdTokenProtectionOptions): SecretConfig {
  const entries = options.secrets ?? parseVersionedSecrets(process.env.BETTER_AUTH_SECRETS)
  if (entries.length === 0) throw new Error('AUTH_VERSIONED_SECRETS_REQUIRED')
  const keys = new Map<number, string>()
  for (const entry of entries) {
    if (keys.has(entry.version)) throw new Error('AUTH_VERSIONED_SECRETS_INVALID')
    keys.set(entry.version, entry.value)
  }
  return {
    currentVersion: entries[0]!.version,
    keys,
  }
}

function assertNoLegacyAuthSecretEnvironment(): void {
  if (process.env.BETTER_AUTH_SECRET !== undefined || process.env.AUTH_SECRET !== undefined) {
    throw new Error('AUTH_LEGACY_SECRET_UNSUPPORTED')
  }
}

/**
 * The pinned Better Auth RC encrypts access/refresh tokens but omits `idToken`
 * at several persistence call sites. Keep that workaround at the one adapter
 * boundary so raw provider ID tokens never enter the component database.
 */
export function createAccountIdTokenProtector(options: IdTokenProtectionOptions) {
  assertNoLegacyAuthSecretEnvironment()
  const accountModel = options.account?.modelName ?? 'account'
  const idTokenField = options.account?.fields?.idToken ?? 'idToken'

  const transform = async <T>(
    model: string,
    data: T,
    direction: 'protect' | 'reveal',
  ): Promise<T> => {
    if (
      model !== accountModel ||
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      !(idTokenField in data)
    ) {
      return data
    }
    const value = (data as Record<string, unknown>)[idTokenField]
    if (value === null || value === undefined || value === '') return data
    if (typeof value !== 'string') throw new Error('AUTH_ID_TOKEN_INVALID')
    if (options.account?.encryptOAuthTokens !== true) {
      throw new Error('AUTH_OAUTH_TOKEN_ENCRYPTION_REQUIRED')
    }
    const secretConfig = idTokenSecretConfig(options)
    let transformed: string
    try {
      if (direction === 'protect') {
        if (value.startsWith(encryptedEnvelopePrefix)) {
          await symmetricDecrypt({ data: value, key: secretConfig })
          transformed = value
        } else {
          transformed = await symmetricEncrypt({ data: value, key: secretConfig })
        }
      } else {
        if (!value.startsWith(encryptedEnvelopePrefix)) {
          throw new Error('AUTH_ID_TOKEN_AT_REST_UNENCRYPTED')
        }
        transformed = await symmetricDecrypt({ data: value, key: secretConfig })
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_ID_TOKEN_AT_REST_UNENCRYPTED') {
        throw error
      }
      // The caught crypto error may contain credential/configuration detail;
      // this storage boundary deliberately exposes only the fixed safe code.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(
        direction === 'protect'
          ? 'AUTH_ID_TOKEN_ENCRYPTION_FAILED'
          : 'AUTH_ID_TOKEN_DECRYPTION_FAILED',
      )
    }
    return { ...(data as Record<string, unknown>), [idTokenField]: transformed } as T
  }

  return {
    protect: <T>(model: string, data: T) => transform(model, data, 'protect'),
    reveal: <T>(model: string, data: T) => transform(model, data, 'reveal'),
  }
}

function toEpochMilliseconds(data: unknown): unknown {
  if (data === null || data === undefined) return data
  const value = data instanceof Date ? data.getTime() : new Date(data as string | number).getTime()
  if (!Number.isFinite(value)) throw new Error('AUTH_DATE_INVALID')
  return value
}

function toDate(data: unknown): unknown {
  if (data === null || data === undefined || data instanceof Date) return data
  if (typeof data !== 'number' || !Number.isFinite(data)) throw new Error('AUTH_DATE_INVALID')
  return new Date(data)
}

async function collectPages<T>(
  next: (paginationOpts: { cursor: string | null; numItems: number }) => Promise<Page<T>>,
  limit?: number,
): Promise<T[]> {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
    throw new Error('AUTH_LIMIT_INVALID')
  }
  if (limit === 0) return []

  const rows: T[] = []
  let cursor: string | null = null
  let complete = false
  while (!complete) {
    const remaining = limit === undefined ? 200 : Math.min(200, limit - rows.length)
    if (remaining <= 0) break
    const cursorBefore: string | null = cursor
    const result = await next({ cursor, numItems: remaining })
    rows.push(...result.page)
    if (result.isDone || (limit !== undefined && rows.length >= limit)) {
      complete = true
      continue
    }
    cursor = result.continueCursor
    if (cursor === cursorBefore && result.page.length === 0) {
      throw new Error('AUTH_PAGINATION_STALLED')
    }
  }
  return limit === undefined ? rows : rows.slice(0, limit)
}

function configuredTriggerModels<DataModel extends GenericDataModel>(
  triggers: AuthComponentTriggers<DataModel> | undefined,
  event: 'onCreate' | 'onUpdate' | 'onDelete',
): string[] {
  return Object.entries(triggers ?? {}).flatMap(([model, configured]) =>
    typeof configured?.[event] === 'function' ? [model] : [],
  )
}

export function createConvexAuthAdapter<
  DataModel extends GenericDataModel,
  Api extends AuthAdapterComponentApi,
>(ctx: AuthCtx<DataModel>, component: Api, adapterOptions: AdapterOptions<DataModel> = {}) {
  const handleCache = new Map<string, Promise<string | undefined>>()

  return createAdapterFactory({
    config: {
      adapterId: 'better-convex-nuxt',
      adapterName: 'Better Convex Nuxt',
      debugLogs: adapterOptions.debugLogs ?? false,
      transaction: false,
      supportsNumericIds: false,
      supportsUUIDs: false,
      supportsJSON: false,
      supportsDates: false,
      supportsBooleans: true,
      supportsArrays: true,
      usePlural: false,
      customTransformInput: ({ data, fieldAttributes }) =>
        fieldAttributes.type === 'date' ? toEpochMilliseconds(data) : data,
      customTransformOutput: ({ data, fieldAttributes }) =>
        fieldAttributes.type === 'date' ? toDate(data) : data,
    },
    adapter: ({ getFieldName, getModelName, options }) => {
      options.telemetry = { enabled: false }
      if (options.advanced?.database?.joins) throw new Error('AUTH_JOINS_UNSUPPORTED')
      const idTokens = createAccountIdTokenProtector(options)
      const triggerModels = {
        onCreate: configuredTriggerModels(adapterOptions.triggers, 'onCreate').map(getModelName),
        onDelete: configuredTriggerModels(adapterOptions.triggers, 'onDelete').map(getModelName),
        onUpdate: configuredTriggerModels(adapterOptions.triggers, 'onUpdate').map(getModelName),
      }
      const triggerHandle = (
        model: string,
        event: 'onCreate' | 'onUpdate' | 'onDelete',
      ): Promise<string | undefined> => {
        const cacheKey = `${event}:${model}`
        const existing = handleCache.get(cacheKey)
        if (existing) return existing
        const reference = adapterOptions.authFunctions?.[event]
        const value =
          reference && triggerModels[event].includes(model)
            ? createFunctionHandle(reference).then(String)
            : Promise.resolve(undefined)
        handleCache.set(cacheKey, value)
        return value
      }
      const relationshipTriggerHandle = (event: 'onUpdate' | 'onDelete') => {
        const cacheKey = `relationship:${event}`
        const existing = handleCache.get(cacheKey)
        if (existing) return existing
        const reference = adapterOptions.authFunctions?.[event]
        const value =
          reference && triggerModels[event].length > 0
            ? createFunctionHandle(reference).then(String)
            : Promise.resolve(undefined)
        handleCache.set(cacheKey, value)
        return value
      }
      const mapSelect = (model: string, select: string[] | undefined) =>
        select?.map((field) => getFieldName({ model, field }))
      const mapSort = (
        model: string,
        sortBy: { direction: 'asc' | 'desc'; field: string } | undefined,
      ) => (sortBy ? { ...sortBy, field: getFieldName({ model, field: sortBy.field }) } : undefined)

      const adapter: CustomAdapter = {
        options: { isRunMutationCtx: isWritableAuthCtx(ctx) },
        createSchema: createAuthSchema,
        create: async <T extends Record<string, unknown>>({
          model,
          data,
        }: {
          data: T
          model: string
        }): Promise<T> => {
          requireWritableAuthCtx(ctx)
          const created = await ctx.runMutation(component.adapter.create, {
            model,
            data: await idTokens.protect(model, data),
            onCreateHandle: await triggerHandle(model, 'onCreate'),
          })
          return idTokens.reveal(model, created as T)
        },
        findOne: async <T>({
          model,
          where,
          select,
        }: {
          join?: JoinConfig
          model: string
          select?: string[]
          where: CleanedWhere[]
        }): Promise<T | null> => {
          const found = await ctx.runQuery(component.adapter.findOne, {
            model,
            where: toComponentWhere(where),
            select: mapSelect(model, select),
          })
          return idTokens.reveal(model, found as T | null)
        },
        findMany: async <T>({
          model,
          where,
          limit,
          select,
          sortBy,
          offset,
        }: {
          join?: JoinConfig
          limit: number
          model: string
          offset?: number
          select?: string[]
          sortBy?: { direction: 'asc' | 'desc'; field: string }
          where?: CleanedWhere[]
        }): Promise<T[]> => {
          if (offset !== undefined && offset !== 0) throw new Error('AUTH_OFFSET_UNSUPPORTED')
          const componentSelect = mapSelect(model, select)
          const componentSortBy = mapSort(model, sortBy)
          const rows = await collectPages<T>(
            (paginationOpts) =>
              ctx.runQuery(component.adapter.findMany, {
                model,
                where: toComponentWhere(where),
                select: componentSelect,
                sortBy: componentSortBy,
                paginationOpts,
              }) as Promise<Page<T>>,
            limit,
          )
          return Promise.all(rows.map((row) => idTokens.reveal(model, row) as Promise<T>))
        },
        count: ({ model, where }) =>
          ctx.runQuery(component.adapter.count, { model, where: toComponentWhere(where) }),
        update: async <T>({
          model,
          where,
          update,
        }: {
          model: string
          update: T
          where: CleanedWhere[]
        }): Promise<T | null> => {
          requireWritableAuthCtx(ctx)
          if (where.length === 0) return null
          const updated = await ctx.runMutation(component.adapter.updateOne, {
            model,
            where: toComponentWhere(where)!,
            update: (await idTokens.protect(model, update)) as ComponentUpdate,
            onUpdateHandle: await triggerHandle(model, 'onUpdate'),
          })
          return idTokens.reveal(model, updated as T | null)
        },
        updateMany: async ({ model, where, update }) => {
          requireWritableAuthCtx(ctx)
          return ctx.runMutation(component.adapter.updateMany, {
            model,
            where: toComponentWhere(where)!,
            update: (await idTokens.protect(model, update)) as ComponentUpdate,
            onUpdateHandle: await triggerHandle(model, 'onUpdate'),
          })
        },
        delete: async ({ model, where }) => {
          requireWritableAuthCtx(ctx)
          await ctx.runMutation(component.adapter.deleteOne, {
            model,
            where: toComponentWhere(where)!,
            onDeleteHandle: await relationshipTriggerHandle('onDelete'),
            onDeleteModels: triggerModels.onDelete,
            onUpdateHandle: await relationshipTriggerHandle('onUpdate'),
            onUpdateModels: triggerModels.onUpdate,
          })
        },
        deleteMany: async ({ model, where }) => {
          requireWritableAuthCtx(ctx)
          return ctx.runMutation(component.adapter.deleteMany, {
            model,
            where: toComponentWhere(where)!,
            onDeleteHandle: await relationshipTriggerHandle('onDelete'),
            onDeleteModels: triggerModels.onDelete,
            onUpdateHandle: await relationshipTriggerHandle('onUpdate'),
            onUpdateModels: triggerModels.onUpdate,
          })
        },
        consumeOne: async <T>({
          model,
          where,
        }: {
          model: string
          where: CleanedWhere[]
        }): Promise<T | null> => {
          requireWritableAuthCtx(ctx)
          const consumed = await ctx.runMutation(component.adapter.consumeOne, {
            model,
            where: toComponentWhere(where)!,
            onDeleteHandle: await relationshipTriggerHandle('onDelete'),
            onDeleteModels: triggerModels.onDelete,
            onUpdateHandle: await relationshipTriggerHandle('onUpdate'),
            onUpdateModels: triggerModels.onUpdate,
          })
          return idTokens.reveal(model, consumed as T | null)
        },
        incrementOne: async <T>({
          model,
          where,
          increment,
          set,
        }: {
          increment: Record<string, number>
          model: string
          set?: Record<string, unknown>
          where: CleanedWhere[]
        }): Promise<T | null> => {
          requireWritableAuthCtx(ctx)
          const incremented = await ctx.runMutation(component.adapter.incrementOne, {
            model,
            where: toComponentWhere(where)!,
            increment,
            set: await idTokens.protect(model, set),
            onUpdateHandle: await triggerHandle(model, 'onUpdate'),
          })
          return idTokens.reveal(model, incremented as T | null)
        },
      }
      return adapter
    },
  })
}
