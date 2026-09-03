import type { GenericDataModel, GenericMutationCtx, GenericQueryCtx } from 'convex/server'

import type { AuthWhere } from '../adapter/query'
import { advanceWorkforceGeneration } from './credential-generation'
import { workforceSessionPolicy, type WorkforceOperation } from './operations'
import { consumeWorkforceTotpReplay } from './replay'

type Ctx = GenericMutationCtx<GenericDataModel>
type Row = Record<string, unknown>
type SessionOperation = Extract<WorkforceOperation, { sessionId: string }>

const pendingFields = [
  'bcnPendingSecret',
  'bcnPendingBackupCodes',
  'bcnPendingSessionId',
  'bcnPendingGeneration',
] as const
const emptyPending = Object.fromEntries(pendingFields.map((field) => [field, null]))

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

async function byId(
  ctx: GenericQueryCtx<GenericDataModel>,
  model: 'user' | 'session' | 'verification',
  id: string,
): Promise<Row | null> {
  return ctx.db
    .query(model)
    .withIndex('id', (query) => query.eq('id', id))
    .unique()
}

function storageId<Table extends 'user' | 'session' | 'twoFactor'>(
  ctx: Ctx,
  model: Table,
  row: Row,
) {
  const id = typeof row._id === 'string' ? ctx.db.normalizeId(model, row._id) : null
  if (!id) throw new Error('AUTH_WORKFORCE_ROW_INVALID')
  return id
}

export async function liveContinuation(
  ctx: GenericQueryCtx<GenericDataModel>,
  operation: WorkforceOperation | undefined,
) {
  if (!operation || !('sessionId' in operation))
    throw new Error('AUTH_WORKFORCE_OPERATION_REQUIRED')
  const { userId, sessionId, expectedGeneration } = operation
  if (
    !userId ||
    !sessionId ||
    !Number.isSafeInteger(expectedGeneration) ||
    expectedGeneration < 0
  ) {
    throw new Error('AUTH_WORKFORCE_OPERATION_INVALID')
  }
  const user = await byId(ctx, 'user', userId)
  const session = await byId(ctx, 'session', sessionId)
  const now = Date.now()
  if (
    !user ||
    !session ||
    session.userId !== userId ||
    user.emailVerified !== true ||
    user.bcnSecurityGeneration !== expectedGeneration ||
    session.bcnAssuranceGeneration !== expectedGeneration ||
    !positive(session.expiresAt) ||
    session.expiresAt <= now ||
    !positive(session.bcnSessionStartedAt) ||
    !positive(session.bcnAuthenticatedAt) ||
    session.bcnSessionStartedAt > session.bcnAuthenticatedAt ||
    session.bcnAuthenticatedAt > now ||
    now - session.bcnSessionStartedAt >= workforceSessionPolicy.absoluteLifetimeMs
  )
    throw new Error('AUTH_WORKFORCE_CONTINUATION_INVALID')
  return { user, session, operation, now }
}

async function factorForUser(ctx: Ctx, userId: string): Promise<Row | null> {
  return ctx.db
    .query('twoFactor')
    .withIndex('userId', (query) => query.eq('userId', userId))
    .unique()
}

export function assertPending(factor: Row | null, session: Row, operation: SessionOperation) {
  if (
    !factor ||
    session.bcnAssuranceMethod !== 'totp-enrollment' ||
    factor.userId !== operation.userId ||
    factor.bcnPendingSessionId !== operation.sessionId ||
    factor.bcnPendingGeneration !== operation.expectedGeneration ||
    typeof factor.bcnPendingSecret !== 'string' ||
    !factor.bcnPendingSecret ||
    typeof factor.bcnPendingBackupCodes !== 'string' ||
    !factor.bcnPendingBackupCodes
  )
    throw new Error('AUTH_WORKFORCE_PENDING_FACTOR_INVALID')
}

export interface RecoveryConsumption {
  where: readonly AuthWhere[]
  increment: Row
}

async function assertRecoveryConsumption(
  ctx: Ctx,
  previous: Row,
  patch: Row,
  operation: Extract<WorkforceOperation, { challengeId: string }>,
  consumption: RecoveryConsumption,
) {
  const guards = consumption.where
  const exactGuard = (field: string) =>
    guards.some((guard) => guard.field === field && guard.value === previous[field])
  if (
    operation.operation !== 'recovery-sign-in' ||
    Object.keys(consumption.increment).length !== 0 ||
    Object.keys(patch).length !== 1 ||
    typeof patch.backupCodes !== 'string' ||
    !patch.backupCodes ||
    typeof previous.backupCodes !== 'string' ||
    !previous.backupCodes ||
    patch.backupCodes === previous.backupCodes ||
    guards.length !== 2 ||
    !exactGuard('id') ||
    !exactGuard('backupCodes') ||
    guards.some(
      (guard) =>
        (guard.operator !== undefined && guard.operator !== 'eq') ||
        (guard.connector !== undefined && guard.connector !== 'AND') ||
        (guard.mode !== undefined && guard.mode !== 'sensitive'),
    )
  )
    throw new Error('AUTH_WORKFORCE_RECOVERY_CAS_REQUIRED')
  const user = await byId(ctx, 'user', operation.userId)
  const challenge = await byId(ctx, 'verification', operation.challengeId)
  if (
    !user ||
    !challenge ||
    !Number.isSafeInteger(operation.expectedGeneration) ||
    operation.expectedGeneration < 0 ||
    user.emailVerified !== true ||
    user.twoFactorEnabled !== true ||
    user.bcnSecurityGeneration !== operation.expectedGeneration ||
    previous.userId !== operation.userId ||
    previous.verified !== true ||
    challenge.value !== operation.userId ||
    challenge.bcnAssuranceGeneration !== operation.expectedGeneration ||
    !positive(challenge.expiresAt) ||
    challenge.expiresAt <= Date.now()
  )
    throw new Error('AUTH_WORKFORCE_RECOVERY_CHALLENGE_INVALID')
  // The provider consumes its primary challenge after this compare-and-swap.
  // Advancing the generation here would invalidate that same successful attempt.
}

async function deferFactorFlag(
  ctx: Ctx,
  previous: Row,
  patch: Row,
  operation: WorkforceOperation | undefined,
): Promise<Row> {
  if (patch.twoFactorEnabled !== true || operation?.operation !== 'confirm-enrollment') {
    throw new Error('AUTH_WORKFORCE_FACTOR_FLAG_FORBIDDEN')
  }
  const live = await liveContinuation(ctx, operation)
  if (previous.id !== operation.userId) throw new Error('AUTH_WORKFORCE_CONTINUATION_INVALID')
  assertPending(await factorForUser(ctx, operation.userId), live.session, live.operation)
  const { twoFactorEnabled: _deferred, ...other } = patch
  return other
}

async function prepareCredentialWrite(
  ctx: Ctx,
  previous: Row | null,
  patch: Row,
  operation: WorkforceOperation | undefined,
  consumption?: RecoveryConsumption,
): Promise<Row> {
  if (previous && operation?.operation === 'recovery-sign-in' && consumption) {
    await assertRecoveryConsumption(ctx, previous, patch, operation, consumption)
    return patch
  }
  if (previous && operation?.operation === 'regenerate-backup-codes' && !consumption) {
    const live = await liveContinuation(ctx, operation)
    if (
      previous.userId !== operation.userId ||
      previous.verified !== true ||
      live.user.twoFactorEnabled !== true ||
      live.session.bcnAssuranceMethod !== 'password-totp' ||
      live.now - Number(live.session.bcnAuthenticatedAt) >=
        workforceSessionPolicy.freshAuthenticationMs
    )
      throw new Error('AUTH_WORKFORCE_FRESH_AUTH_REQUIRED')
    if (
      Object.keys(patch).length !== 1 ||
      typeof patch.backupCodes !== 'string' ||
      !patch.backupCodes
    ) {
      throw new Error('AUTH_WORKFORCE_BACKUP_REGENERATION_INVALID')
    }
    await advanceWorkforceGeneration(ctx, operation.userId)
    return { ...patch, ...emptyPending }
  }
  if (operation?.operation !== 'begin-enrollment')
    throw new Error('AUTH_WORKFORCE_OPERATION_REQUIRED')
  const live = await liveContinuation(ctx, operation)
  const current = await factorForUser(ctx, operation.userId)
  if ((previous && previous.id !== current?.id) || (!previous && current)) {
    throw new Error('AUTH_WORKFORCE_FACTOR_CONFLICT')
  }
  if ((previous?.userId ?? patch.userId) !== operation.userId) {
    throw new Error('AUTH_WORKFORCE_CONTINUATION_INVALID')
  }
  const method = live.session.bcnAssuranceMethod
  if (method === 'totp-enrollment') {
    assertPending(current, live.session, live.operation)
  } else {
    const fresh =
      live.now - Number(live.session.bcnAuthenticatedAt) <
      workforceSessionPolicy.freshAuthenticationMs
    const initial =
      method === 'password-only' &&
      live.user.twoFactorEnabled !== true &&
      current?.verified !== true
    const approved = method === 'password-totp' || method === 'password-recovery'
    if (!fresh || (!initial && !approved)) throw new Error('AUTH_WORKFORCE_FRESH_AUTH_REQUIRED')
  }
  if (
    typeof patch.secret !== 'string' ||
    !patch.secret ||
    typeof patch.backupCodes !== 'string' ||
    !patch.backupCodes
  ) {
    throw new Error('AUTH_WORKFORCE_PENDING_FACTOR_INVALID')
  }
  const generation = await advanceWorkforceGeneration(ctx, operation.userId)
  await ctx.db.patch('session', storageId(ctx, 'session', live.session), {
    bcnAssuranceGeneration: generation,
    bcnAssuranceMethod: 'totp-enrollment',
  })
  return {
    ...patch,
    secret: previous?.secret ?? '',
    backupCodes: previous?.backupCodes ?? '',
    verified: previous?.verified ?? false,
    bcnPendingSecret: patch.secret,
    bcnPendingBackupCodes: patch.backupCodes,
    bcnPendingSessionId: operation.sessionId,
    bcnPendingGeneration: generation,
  }
}

async function confirmFactor(
  ctx: Ctx,
  previous: Row | null,
  patch: Row,
  operation: WorkforceOperation | undefined,
): Promise<Row> {
  if (patch.verified !== true || operation?.operation !== 'confirm-enrollment') {
    throw new Error('AUTH_WORKFORCE_FACTOR_CONFIRMATION_REQUIRED')
  }
  const live = await liveContinuation(ctx, operation)
  assertPending(previous, live.session, live.operation)
  if (
    !operation.replay ||
    typeof previous?.id !== 'string' ||
    typeof previous.bcnPendingSecret !== 'string'
  ) {
    throw new Error('AUTH_WORKFORCE_REPLAY_PROOF_REQUIRED')
  }
  await consumeWorkforceTotpReplay(ctx, operation.replay, {
    userId: operation.userId,
    factorId: previous.id,
    factorSecret: previous.bcnPendingSecret,
  })
  const generation = await advanceWorkforceGeneration(ctx, operation.userId)
  await ctx.db.patch('user', storageId(ctx, 'user', live.user), { twoFactorEnabled: true })
  await ctx.db.patch('session', storageId(ctx, 'session', live.session), {
    bcnAssuranceGeneration: generation,
    bcnAssuranceMethod: 'none',
  })
  return {
    ...patch,
    ...emptyPending,
    secret: previous.bcnPendingSecret,
    backupCodes: previous.bcnPendingBackupCodes,
  }
}

/** Runs inside the existing component write, before the normalized patch is applied. */
export async function prepareWorkforceFactorWrite(
  ctx: Ctx,
  model: string,
  previous: Row | null,
  patch: Row,
  operation: WorkforceOperation | undefined,
  consumption?: RecoveryConsumption,
): Promise<Row> {
  if (
    previous &&
    model === 'user' &&
    'twoFactorEnabled' in patch &&
    patch.twoFactorEnabled !== previous.twoFactorEnabled
  ) {
    return deferFactorFlag(ctx, previous, patch, operation)
  }
  if (model !== 'twoFactor') return patch
  if (
    pendingFields.some((field) => field in patch && (previous !== null || patch[field] !== null))
  ) {
    throw new Error('AUTH_WORKFORCE_PENDING_FIELDS_OWNED')
  }
  if (previous && 'userId' in patch && patch.userId !== previous.userId) {
    throw new Error('AUTH_WORKFORCE_FACTOR_OWNER_IMMUTABLE')
  }
  if (!previous || ['secret', 'backupCodes'].some((field) => field in patch)) {
    return prepareCredentialWrite(ctx, previous, patch, operation, consumption)
  }
  return 'verified' in patch ? confirmFactor(ctx, previous, patch, operation) : patch
}

/** Preserve the setup lifetime and move its binding during provider session rotation. */
export async function prepareWorkforceEnrollmentSession(
  ctx: Ctx,
  row: Row,
  operation: WorkforceOperation | undefined,
): Promise<Row> {
  if (operation?.operation !== 'confirm-enrollment') return row
  const live = await liveContinuation(ctx, operation)
  const factor = await factorForUser(ctx, operation.userId)
  assertPending(factor, live.session, live.operation)
  if (
    row.userId !== operation.userId ||
    typeof row.id !== 'string' ||
    !row.id ||
    row.id === operation.sessionId
  ) {
    throw new Error('AUTH_WORKFORCE_CONTINUATION_INVALID')
  }
  await ctx.db.patch('twoFactor', storageId(ctx, 'twoFactor', factor!), {
    bcnPendingSessionId: row.id,
  })
  return {
    ...row,
    bcnAssuranceGeneration: operation.expectedGeneration,
    bcnAssuranceMethod: 'totp-enrollment',
    bcnAuthenticatedAt: live.session.bcnAuthenticatedAt,
    bcnSessionStartedAt: live.session.bcnSessionStartedAt,
    expiresAt: Math.min(Number(row.expiresAt), Number(live.session.expiresAt)),
  }
}
