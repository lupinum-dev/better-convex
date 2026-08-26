import { ConvexError } from 'convex/values'

export interface BetterAuthUserProjectionSource {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
  [key: string]: unknown
}

type UserProjectionDb<TExistingUser extends { _id: unknown }> = {
  insert(table: string, value: Record<string, unknown>): Promise<unknown>
  query(table: string): unknown
  patch(id: TExistingUser['_id'], value: Record<string, unknown>): Promise<unknown>
  delete(id: TExistingUser['_id']): Promise<unknown>
}

type UserProjectionCtx<TExistingUser extends { _id: unknown }> = {
  db: UserProjectionDb<TExistingUser>
}

export interface CreateUserProjectionTriggersOptions<
  TAuthUser extends BetterAuthUserProjectionSource = BetterAuthUserProjectionSource,
  TExistingUser extends { _id: unknown } = { _id: unknown },
  TCtx extends UserProjectionCtx<TExistingUser> = UserProjectionCtx<TExistingUser>,
> {
  /**
   * Convex table to project Better Auth users into (for example: "userProfiles").
   */
  table: string
  /**
   * Index used to find the app user by Better Auth id (for example: "by_auth_id").
   */
  index: string
  /**
   * Field in your app user table storing the Better Auth user id (default: "authId").
   */
  authIdField?: string
  /**
   * Build the document inserted when a projection row is missing.
   */
  createDoc: (args: {
    ctx: TCtx
    user: TAuthUser
    now: number
  }) => Record<string, unknown> | Promise<Record<string, unknown>>
  /**
   * Build a patch for app user updates. Return null/undefined to skip patching.
   */
  patchDoc?: (args: {
    ctx: TCtx
    user: TAuthUser
    previousUser: TAuthUser
    existing: TExistingUser
    now: number
  }) =>
    | Record<string, unknown>
    | null
    | undefined
    | Promise<Record<string, unknown> | null | undefined>
  /**
   * Build a patch for rebuild jobs when the projection row already exists.
   *
   * Existing rows are skipped during rebuild when this is omitted, which avoids
   * overwriting fields such as createdAt with insert-only values from createDoc.
   */
  rebuildDoc?: (args: {
    ctx: TCtx
    user: TAuthUser
    existing: TExistingUser
    now: number
  }) =>
    | Record<string, unknown>
    | null
    | undefined
    | Promise<Record<string, unknown> | null | undefined>
}

type ConvexQueryChain<TExistingUser> = {
  withIndex(
    indexName: string,
    cb: (q: UserProjectionIndexRangeBuilder) => unknown,
  ): {
    collect: () => Promise<TExistingUser[]>
    take: (limit: number) => Promise<TExistingUser[]>
  }
}

type UserProjectionIndexRangeBuilder = {
  eq(field: string, value: unknown): unknown
}

interface UserProjectionRebuildResult {
  inserted: number
  patched: number
  skipped: number
}

interface UserProjectionLookup {
  readonly table: string
  readonly index: string
  readonly authIdField: string
}

const projectionConflictData = Object.freeze({
  code: 'AUTH_USER_PROJECTION_CONFLICT' as const,
})

function resolveAuthIdField(field: string | undefined): string {
  const resolved = field ?? 'authId'
  const startsWithReservedPrefix = resolved.startsWith('$') || resolved.startsWith('_')
  let containsInvalidCharacter = false
  for (let index = 0; index < resolved.length && index <= 1024; index += 1) {
    const code = resolved.charCodeAt(index)
    if (code < 32 || code >= 127) {
      containsInvalidCharacter = true
      break
    }
  }
  if (
    resolved.length === 0 ||
    resolved.length > 1024 ||
    startsWithReservedPrefix ||
    containsInvalidCharacter ||
    resolved.includes('.') ||
    resolved === 'prototype' ||
    resolved === 'constructor'
  ) {
    throw new TypeError(
      '[better-convex-nuxt] authIdField must be a valid top-level Convex application field',
    )
  }
  return resolved
}

function withCanonicalAuthId(
  value: Record<string, unknown>,
  authIdField: string,
  authUserId: string,
): Record<string, unknown> {
  return { ...value, [authIdField]: authUserId }
}

function indexedProjectionQuery<TExistingUser extends { _id: unknown }>(
  ctx: { db: Pick<UserProjectionDb<TExistingUser>, 'query'> },
  lookup: UserProjectionLookup,
  authUserId: string,
): ReturnType<ConvexQueryChain<TExistingUser>['withIndex']> {
  const query = ctx.db.query(lookup.table) as ConvexQueryChain<TExistingUser>

  return query.withIndex(lookup.index, (q: UserProjectionIndexRangeBuilder) =>
    q.eq(lookup.authIdField, authUserId),
  )
}

async function findUnambiguousProjection<TExistingUser extends { _id: unknown }>(
  ctx: { db: Pick<UserProjectionDb<TExistingUser>, 'query'> },
  lookup: UserProjectionLookup,
  authUserId: string,
): Promise<TExistingUser | undefined> {
  const existing = await indexedProjectionQuery<TExistingUser>(ctx, lookup, authUserId).take(2)
  if (existing.length > 1) {
    throw new ConvexError(projectionConflictData)
  }
  return existing[0]
}

async function findAllProjections<TExistingUser extends { _id: unknown }>(
  ctx: { db: Pick<UserProjectionDb<TExistingUser>, 'query'> },
  lookup: UserProjectionLookup,
  authUserId: string,
): Promise<TExistingUser[]> {
  return await indexedProjectionQuery<TExistingUser>(ctx, lookup, authUserId).collect()
}

/**
 * Creates Better Auth trigger handlers that project auth users into a Convex app table.
 *
 * This intentionally scopes to user projection boilerplate only. Better Auth
 * remains the canonical source of auth truth; app tables created with this
 * helper must be treated as derived and rebuildable.
 */
export function createUserProjectionTriggers<
  TAuthUser extends BetterAuthUserProjectionSource = BetterAuthUserProjectionSource,
  TExistingUser extends { _id: unknown } = { _id: unknown },
  TCtx extends UserProjectionCtx<TExistingUser> = UserProjectionCtx<TExistingUser>,
>(options: CreateUserProjectionTriggersOptions<TAuthUser, TExistingUser, TCtx>) {
  const lookup: UserProjectionLookup = Object.freeze({
    table: options.table,
    index: options.index,
    authIdField: resolveAuthIdField(options.authIdField),
  })

  return {
    user: {
      onCreate: async (ctx: TCtx, user: TAuthUser) => {
        const now = Date.now()
        const existing = await findUnambiguousProjection<TExistingUser>(ctx, lookup, user.id)
        if (existing) return

        const doc = await options.createDoc({ ctx, user, now })
        await ctx.db.insert(options.table, withCanonicalAuthId(doc, lookup.authIdField, user.id))
      },
      /**
       * Patches an existing projection or creates one from the current update
       * snapshot when trigger delivery arrives before creation.
       */
      onUpdate: async (ctx: TCtx, user: TAuthUser, previousUser: TAuthUser) => {
        const now = Date.now()
        const existing = await findUnambiguousProjection<TExistingUser>(ctx, lookup, user.id)
        if (!existing) {
          const doc = await options.createDoc({ ctx, user, now })
          await ctx.db.insert(options.table, withCanonicalAuthId(doc, lookup.authIdField, user.id))
          return
        }

        if (!options.patchDoc) return

        const patch = await options.patchDoc({
          ctx,
          user,
          previousUser,
          existing,
          now,
        })
        if (!patch || Object.keys(patch).length === 0) return

        await ctx.db.patch(existing._id, withCanonicalAuthId(patch, lookup.authIdField, user.id))
      },
      onDelete: async (ctx: TCtx, user: TAuthUser) => {
        const existing = await findAllProjections<TExistingUser>(ctx, lookup, user.id)
        for (const row of existing) {
          await ctx.db.delete(row._id)
        }
      },
      rebuild: async (
        ctx: TCtx,
        users: readonly TAuthUser[],
      ): Promise<UserProjectionRebuildResult> => {
        const result: UserProjectionRebuildResult = {
          inserted: 0,
          patched: 0,
          skipped: 0,
        }

        for (const user of users) {
          const now = Date.now()
          const existing = await findUnambiguousProjection<TExistingUser>(ctx, lookup, user.id)

          if (!existing) {
            const doc = await options.createDoc({ ctx, user, now })
            await ctx.db.insert(
              options.table,
              withCanonicalAuthId(doc, lookup.authIdField, user.id),
            )
            result.inserted += 1
            continue
          }

          if (!options.rebuildDoc) {
            result.skipped += 1
            continue
          }

          const patch = await options.rebuildDoc({
            ctx,
            user,
            existing,
            now,
          })
          if (!patch || Object.keys(patch).length === 0) {
            result.skipped += 1
            continue
          }

          await ctx.db.patch(existing._id, withCanonicalAuthId(patch, lookup.authIdField, user.id))
          result.patched += 1
        }

        return result
      },
    },
  }
}
