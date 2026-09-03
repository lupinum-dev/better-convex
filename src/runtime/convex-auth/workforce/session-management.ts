import type { GenericDataModel, GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import { v, type GenericId, type Infer } from 'convex/values'

import type { AuthSchemaMetadata } from '../adapter/metadata'
import { paginateAuthRows } from '../adapter/query'
import { readAuthSessionAdmission } from './admission'
import { advanceWorkforceGeneration } from './credential-generation'
import { workforceSessionPolicy } from './operations'

type ReadCtx = GenericQueryCtx<GenericDataModel>
type WriteCtx = GenericMutationCtx<GenericDataModel>

/** Server-derived binding only; a browser must never supply these actor fields. */
export const workforceSessionActorValidator = v.object({
  userId: v.string(),
  sessionId: v.string(),
})
export type WorkforceSessionActor = Infer<typeof workforceSessionActorValidator>

const sessionMethodValidator = v.union(
  v.literal('password-only'),
  v.literal('totp-enrollment'),
  v.literal('password-totp'),
  v.literal('password-recovery'),
)

export const workforceSessionSummaryValidator = v.object({
  sessionId: v.string(),
  isCurrent: v.boolean(),
  sessionStartedAt: v.number(),
  authenticatedAt: v.number(),
  expiresAt: v.number(),
  method: sessionMethodValidator,
})
export type WorkforceSessionSummary = Infer<typeof workforceSessionSummaryValidator>

export const workforceSessionPageOptionsValidator = v.object({
  cursor: v.union(v.string(), v.null()),
  numItems: v.number(),
})
export const workforceSessionPageValidator = v.object({
  page: v.array(workforceSessionSummaryValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
})

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function sessionStorageId(ctx: ReadCtx, value: unknown): GenericId<'session'> {
  const id = typeof value === 'string' ? ctx.db.normalizeId('session', value) : null
  if (!id) throw new Error('AUTH_WORKFORCE_SESSION_INVALID')
  return id
}

async function requireActor(ctx: ReadCtx, actor: WorkforceSessionActor) {
  const admitted = await readAuthSessionAdmission(ctx, actor, true)
  if (!admitted) throw new Error('AUTH_WORKFORCE_SESSION_REQUIRED')
  const { user, session } = admitted
  const startedAt = session.bcnSessionStartedAt
  const generation = user.bcnSecurityGeneration
  if (!positive(startedAt) || typeof generation !== 'number')
    throw new Error('AUTH_WORKFORCE_SESSION_INVALID')
  return {
    storageId: sessionStorageId(ctx, session._id),
    startedAt,
    generation,
  }
}

/** Foreground activity renews idle time, never authentication or absolute age. */
export async function touchWorkforceSession(ctx: WriteCtx, actor: WorkforceSessionActor) {
  const live = await requireActor(ctx, actor)
  const expiresAt = Math.min(
    Date.now() + workforceSessionPolicy.idleTimeoutMs,
    live.startedAt + workforceSessionPolicy.absoluteLifetimeMs,
  )
  await ctx.db.patch('session', live.storageId, { expiresAt })
  return { expiresAt }
}

function summary(
  row: Readonly<Record<string, unknown>>,
  actor: WorkforceSessionActor,
  generation: number,
  now: number,
): WorkforceSessionSummary | null {
  const method = row.bcnAssuranceMethod
  if (
    typeof row.id !== 'string' ||
    !row.id ||
    row.userId !== actor.userId ||
    row.bcnAssuranceGeneration !== generation ||
    (method !== 'password-only' &&
      method !== 'totp-enrollment' &&
      method !== 'password-totp' &&
      method !== 'password-recovery') ||
    !positive(row.bcnSessionStartedAt) ||
    !positive(row.bcnAuthenticatedAt) ||
    !positive(row.expiresAt) ||
    row.bcnSessionStartedAt > row.bcnAuthenticatedAt ||
    row.bcnAuthenticatedAt > now ||
    row.expiresAt <= now ||
    now - row.bcnSessionStartedAt >= workforceSessionPolicy.absoluteLifetimeMs
  )
    return null
  return {
    sessionId: row.id,
    isCurrent: row.id === actor.sessionId,
    sessionStartedAt: row.bcnSessionStartedAt,
    authenticatedAt: row.bcnAuthenticatedAt,
    expiresAt: row.expiresAt,
    method,
  }
}

/** Only a current full actor may inspect credential-free, bounded session pages. */
export async function listWorkforceSessions(
  ctx: ReadCtx,
  actor: WorkforceSessionActor,
  options: Infer<typeof workforceSessionPageOptionsValidator>,
  source: { schema: Parameters<typeof paginateAuthRows>[1]; metadata: AuthSchemaMetadata },
): Promise<Infer<typeof workforceSessionPageValidator>> {
  const live = await requireActor(ctx, actor)
  if (!Number.isSafeInteger(options.numItems) || options.numItems < 1 || options.numItems > 50)
    throw new Error('AUTH_WORKFORCE_SESSION_PAGE_INVALID')
  const now = Date.now()
  // Native pagination cannot run inside components. Reuse the adapter's bounded
  // stream pagination (200 rows maximum), scoped to the live actor's user index.
  const result = await paginateAuthRows(
    ctx,
    source.schema,
    source.metadata,
    {
      model: 'session',
      where: [{ field: 'userId', value: actor.userId }],
      select: [
        'id',
        'userId',
        'expiresAt',
        'bcnAssuranceGeneration',
        'bcnAssuranceMethod',
        'bcnAuthenticatedAt',
        'bcnSessionStartedAt',
      ],
    },
    { ...options, maximumBytesRead: 1_000_000 },
  )
  return {
    page: result.page.flatMap((row) => {
      const item = summary(row, actor, live.generation, now)
      return item ? [item] : []
    }),
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  }
}

/** Missing and foreign targets are indistinguishable; neither authorizes a write. */
export async function revokeWorkforceSession(
  ctx: WriteCtx,
  actor: WorkforceSessionActor,
  targetSessionId: string,
): Promise<null> {
  await requireActor(ctx, actor)
  const target = await ctx.db
    .query('session')
    .withIndex('id', (query) => query.eq('id', targetSessionId))
    .unique()
  if (target?.userId === actor.userId)
    await ctx.db.delete('session', sessionStorageId(ctx, target._id))
  return null
}

/** Generation invalidates every old proof/challenge atomically without an unbounded scan. */
export async function revokeAllWorkforceSessions(
  ctx: WriteCtx,
  actor: WorkforceSessionActor,
): Promise<null> {
  const live = await requireActor(ctx, actor)
  await advanceWorkforceGeneration(ctx, actor.userId)
  await ctx.db.delete('session', live.storageId)
  return null
}

/** The component-owned scheduler uses the returned deadline to continue its one chain. */
export async function expireWorkforceSession(
  ctx: WriteCtx,
  storageId: GenericId<'session'>,
): Promise<number | null> {
  const session = await ctx.db.get('session', storageId)
  if (!session) return null
  const expiresAt = session.expiresAt
  const startedAt = session.bcnSessionStartedAt
  const deadline =
    positive(expiresAt) && positive(startedAt)
      ? Math.min(expiresAt, startedAt + workforceSessionPolicy.absoluteLifetimeMs)
      : null
  if (deadline !== null && deadline > Date.now()) return deadline
  await ctx.db.delete('session', storageId)
  return null
}
