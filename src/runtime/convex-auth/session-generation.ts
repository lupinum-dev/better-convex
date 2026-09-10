import type { GenericDataModel, GenericMutationCtx, GenericQueryCtx } from 'convex/server'

import type { AuthSchemaMetadata } from './adapter/metadata'
import type { AuthWhere } from './adapter/query'

type ReadCtx = GenericQueryCtx<GenericDataModel>
type WriteCtx = GenericMutationCtx<GenericDataModel>
type Row = Record<string, unknown>

export type SessionGenerationMigrationModel = 'session' | 'user'
export type SessionGenerationMigrationMode = 'forward' | 'preflight' | 'rollback'

export interface SessionGenerationMigrationPage {
  done: boolean
  nextAfter: string | null
  pending: number
  patched: number
  scanned: number
}

export interface SessionGenerationAuthority {
  assuranceGenerationField: string
  securityGenerationField: string
  sessionModel: string
  userIdField: string
  userModel: string
}

export const canonicalSessionGenerationAuthority: SessionGenerationAuthority = Object.freeze({
  assuranceGenerationField: 'bcnAssuranceGeneration',
  securityGenerationField: 'bcnSecurityGeneration',
  sessionModel: 'session',
  userIdField: 'userId',
  userModel: 'user',
})

export function sessionGenerationAuthority(
  metadata: AuthSchemaMetadata,
): SessionGenerationAuthority | null {
  const model = (logicalName: string) =>
    Object.values(metadata.models).find((candidate) => candidate.logicalName === logicalName)
  const user = model('user')
  const session = model('session')
  if (!user && !session) return null
  const field = (owner: typeof user, logicalName: string) =>
    owner &&
    Object.values(owner.fields).find((candidate) => candidate.logicalName === logicalName)
      ?.physicalName
  const assuranceGenerationField = field(session, 'bcnAssuranceGeneration')
  const securityGenerationField = field(user, 'bcnSecurityGeneration')
  const sessionModel = session?.physicalName
  const userIdField = field(session, 'userId')
  const userModel = user?.physicalName
  if (
    !assuranceGenerationField ||
    !securityGenerationField ||
    !sessionModel ||
    !userIdField ||
    !userModel
  ) {
    throw new Error('AUTH_SESSION_GENERATION_SCHEMA_INVALID')
  }
  return {
    assuranceGenerationField,
    securityGenerationField,
    sessionModel,
    userIdField,
    userModel,
  }
}

function generation(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function migrationStorageId(row: Row): string {
  if (typeof row._id !== 'string' || !row._id) {
    throw new Error('AUTH_SESSION_GENERATION_MIGRATION_ROW_INVALID')
  }
  return row._id
}

function migrationLogicalId(row: Row): string {
  if (typeof row.id !== 'string' || !row.id) {
    throw new Error('AUTH_SESSION_GENERATION_MIGRATION_ROW_INVALID')
  }
  return row.id
}

async function assertUniqueMigrationLogicalId(
  ctx: ReadCtx,
  table: string,
  logicalId: string,
): Promise<void> {
  const matches = await ctx.db
    .query(table as never)
    .withIndex('id', (query) => query.eq('id', logicalId))
    .take(2)
  if (matches.length !== 1) {
    throw new Error('AUTH_SESSION_GENERATION_MIGRATION_LOGICAL_ID_INVALID')
  }
}

async function readUser(
  ctx: ReadCtx,
  userId: string,
  authority: SessionGenerationAuthority,
): Promise<Row | null> {
  return await ctx.db
    .query(authority.userModel as never)
    .withIndex('id', (query) => query.eq('id', userId))
    .unique()
}

/** Temporary beta.3-to-beta.5 operator migration. Remove after the hard cut is complete. */
export async function migrateSessionGenerationPage(
  ctx: WriteCtx,
  model: SessionGenerationMigrationModel,
  mode: SessionGenerationMigrationMode,
  after: string | null,
  authority = canonicalSessionGenerationAuthority,
): Promise<SessionGenerationMigrationPage> {
  const table = model === 'user' ? authority.userModel : authority.sessionModel
  const generationField =
    model === 'user' ? authority.securityGenerationField : authority.assuranceGenerationField
  // User rollback also checks up to 129 sessions per user. Its smaller page
  // keeps the complete mutation comfortably below Convex read limits.
  const pageSize = mode === 'rollback' && model === 'user' ? 16 : 128
  const rows = await ctx.db
    .query(table as never)
    .withIndex('id', (query) => (after === null ? query : query.gt('id', after)))
    .take(pageSize + 1)
  const page = rows.slice(0, pageSize) as Row[]
  let pending = 0
  let patched = 0

  for (const row of page) {
    const logicalId = migrationLogicalId(row)
    await assertUniqueMigrationLogicalId(ctx, table, logicalId)
    const storageId = migrationStorageId(row)
    const current = row[generationField]
    let expected = 0

    if (model === 'session') {
      const userId = row[authority.userIdField]
      if (typeof userId !== 'string' || !userId) {
        throw new Error('AUTH_SESSION_GENERATION_MIGRATION_SESSION_INVALID')
      }
      const user = await readUser(ctx, userId, authority)
      const userGeneration = user?.[authority.securityGenerationField]
      if (!user || (userGeneration !== undefined && !generation(userGeneration))) {
        throw new Error('AUTH_SESSION_GENERATION_MIGRATION_USER_INVALID')
      }
      if (mode === 'forward' && userGeneration === undefined) {
        throw new Error('AUTH_SESSION_GENERATION_MIGRATION_USER_NOT_READY')
      }
      expected = userGeneration ?? 0
    }

    if (mode === 'rollback') {
      if ((current !== undefined && current !== 0) || expected !== 0) {
        throw new Error('AUTH_SESSION_GENERATION_MIGRATION_ROLLBACK_UNSAFE')
      }
      if (model === 'user') {
        const sessions = await ctx.db
          .query(authority.sessionModel as never)
          .withIndex('userId', (query) => query.eq(authority.userIdField, logicalId))
          .take(129)
        if (
          sessions.length > 128 ||
          sessions.some((session) => session[authority.assuranceGenerationField] !== undefined)
        ) {
          throw new Error('AUTH_SESSION_GENERATION_MIGRATION_ROLLBACK_ORDER')
        }
      }
      if (current === undefined) continue
      await ctx.db.patch(table as never, storageId as never, { [generationField]: undefined })
      patched += 1
      continue
    }

    if (current === undefined) {
      pending += 1
      if (mode === 'forward') {
        await ctx.db.patch(table as never, storageId as never, { [generationField]: expected })
        patched += 1
      }
      continue
    }

    if (!generation(current) || current !== expected) {
      throw new Error('AUTH_SESSION_GENERATION_MIGRATION_GENERATION_INVALID')
    }

    // Reading the logical ID before every decision proves that pagination cannot
    // silently advance across a malformed row.
    void logicalId
  }

  return {
    done: rows.length <= pageSize,
    nextAfter: rows.length <= pageSize ? null : migrationLogicalId(page.at(-1)!),
    pending: mode === 'preflight' ? pending : 0,
    patched,
    scanned: page.length,
  }
}

/** Add component-owned generation fields before strict generated-schema normalization. */
export async function prepareSessionGenerationCreate(
  ctx: ReadCtx,
  model: string,
  input: unknown,
  authority = canonicalSessionGenerationAuthority,
): Promise<unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const row = input as Row
  if (model === authority.userModel) return { ...row, [authority.securityGenerationField]: 0 }
  const userId = row[authority.userIdField]
  if (model !== authority.sessionModel || typeof userId !== 'string' || !userId) return row
  const user = await readUser(ctx, userId, authority)
  if (!user) {
    throw new Error(
      `AUTH_REFERENCE_TARGET_MISSING:${authority.sessionModel}.${authority.userIdField}`,
    )
  }
  const current = user[authority.securityGenerationField]
  if (!generation(current)) {
    throw new Error('AUTH_SESSION_GENERATION_USER_INVALID')
  }
  return { ...row, [authority.assuranceGenerationField]: current }
}

/** Generic adapter updates must never mint or move session-generation authority. */
export function assertSessionGenerationUpdate(
  model: string,
  patch: Row,
  authority = canonicalSessionGenerationAuthority,
): void {
  if (
    (model === authority.userModel && authority.securityGenerationField in patch) ||
    (model === authority.sessionModel && authority.assuranceGenerationField in patch)
  ) {
    throw new Error('AUTH_SESSION_GENERATION_FIELDS_OWNED')
  }
}

/** Advance the canonical generation in the same mutation that authorizes invalidation. */
export async function advanceSessionGeneration(
  ctx: WriteCtx,
  userId: unknown,
  authority = canonicalSessionGenerationAuthority,
): Promise<number> {
  if (typeof userId !== 'string' || !userId) throw new Error('AUTH_SESSION_GENERATION_USER_INVALID')
  const user = await readUser(ctx, userId, authority)
  const current = user?.[authority.securityGenerationField]
  if (!user || typeof user._id !== 'string' || !generation(current)) {
    throw new Error('AUTH_SESSION_GENERATION_USER_INVALID')
  }
  if (current === Number.MAX_SAFE_INTEGER) throw new Error('AUTH_SESSION_GENERATION_EXHAUSTED')
  const storageId = ctx.db.normalizeId(authority.userModel as never, user._id)
  if (!storageId) throw new Error('AUTH_SESSION_GENERATION_USER_INVALID')
  const next = current + 1
  await ctx.db.patch(authority.userModel as never, storageId, {
    [authority.securityGenerationField]: next,
  })
  return next
}

/** Hide stale sessions from both provider CRUD and component admission. */
export async function currentSessionOrNull(
  ctx: ReadCtx,
  row: Row | null,
  authority = canonicalSessionGenerationAuthority,
): Promise<Row | null> {
  const userId = row?.[authority.userIdField]
  const sessionGeneration = row?.[authority.assuranceGenerationField]
  if (!row || typeof userId !== 'string' || !generation(sessionGeneration)) {
    return null
  }
  const user = await readUser(ctx, userId, authority)
  return user?.[authority.securityGenerationField] === sessionGeneration ? row : null
}

/** Compare a session with the canonical user generation already loaded by the caller. */
export function sessionGenerationMatches(
  user: Row,
  session: Row,
  authority = canonicalSessionGenerationAuthority,
): boolean {
  const userGeneration = user[authority.securityGenerationField]
  const sessionGeneration = session[authority.assuranceGenerationField]
  return (
    generation(userGeneration) &&
    generation(sessionGeneration) &&
    userGeneration === sessionGeneration
  )
}

/** Recognize Better Auth's canonical deleteUserSessions selector. */
export async function invalidateSessionCollection(
  ctx: WriteCtx,
  model: string,
  where: readonly AuthWhere[],
  authority = canonicalSessionGenerationAuthority,
): Promise<number | null> {
  const owner = where.length === 1 ? where[0] : undefined
  if (
    model !== authority.sessionModel ||
    owner?.field !== authority.userIdField ||
    (owner.operator !== undefined && owner.operator !== 'eq') ||
    owner.connector === 'OR' ||
    owner.mode !== undefined ||
    typeof owner.value !== 'string' ||
    !owner.value
  ) {
    return null
  }
  const user = await readUser(ctx, owner.value, authority)
  if (!user) return 0
  await advanceSessionGeneration(ctx, owner.value, authority)
  return 0
}
