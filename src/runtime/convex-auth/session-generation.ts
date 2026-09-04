import type { GenericDataModel, GenericMutationCtx, GenericQueryCtx } from 'convex/server'

import type { AuthSchemaMetadata } from './adapter/metadata'
import type { AuthWhere } from './adapter/query'

type ReadCtx = GenericQueryCtx<GenericDataModel>
type WriteCtx = GenericMutationCtx<GenericDataModel>
type Row = Record<string, unknown>

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
