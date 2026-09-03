import type { GenericDataModel, GenericMutationCtx } from 'convex/server'

import { advanceWorkforceGeneration } from './credential-generation'
import { prepareWorkforceEnrollmentSession } from './factor-transitions'
import {
  workforceSessionPolicy,
  type WorkforceConsumedChallenge,
  type WorkforceOperation,
} from './operations'
import { assertGenericVerificationWrite, consumeWorkforceTotpReplay } from './replay'

type Ctx = GenericMutationCtx<GenericDataModel>
type Row = Record<string, unknown>

const ownedFields = {
  user: ['bcnSecurityGeneration'],
  session: [
    'bcnAssuranceGeneration',
    'bcnAssuranceMethod',
    'bcnAuthenticatedAt',
    'bcnSessionStartedAt',
  ],
  verification: ['bcnAssuranceGeneration'],
} as const

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Generic adapter updates cannot mint, move, or refresh authentication proof. */
export function prepareWorkforceProofUpdate(model: string, previous: Row, patch: Row): Row {
  if (model === 'verification') assertGenericVerificationWrite(previous, { ...previous, ...patch })
  const fields =
    model === 'user' || model === 'session' || model === 'verification' ? ownedFields[model] : []
  if (fields.some((field) => field in patch)) {
    throw new Error('AUTH_WORKFORCE_PROOF_FIELDS_OWNED')
  }
  if (model !== 'session') return patch
  if ('userId' in patch && patch.userId !== previous.userId) {
    throw new Error('AUTH_WORKFORCE_SESSION_OWNER_IMMUTABLE')
  }
  if (!('expiresAt' in patch)) return patch
  if (
    !positive(previous.bcnSessionStartedAt) ||
    !positive(previous.expiresAt) ||
    !positive(patch.expiresAt)
  ) {
    throw new Error('AUTH_WORKFORCE_SESSION_LIFETIME_INVALID')
  }
  // Shortening outside the owned revoke path would leave the scheduled expiry
  // later than the row deadline, delaying invalidation of open subscriptions.
  if (patch.expiresAt < previous.expiresAt) throw new Error('AUTH_WORKFORCE_SESSION_LIFETIME_OWNED')
  return {
    ...patch,
    expiresAt: Math.min(
      patch.expiresAt,
      previous.expiresAt,
      previous.bcnSessionStartedAt + workforceSessionPolicy.absoluteLifetimeMs,
    ),
  }
}

async function currentUser(ctx: Ctx, operation: WorkforceOperation) {
  if (
    !operation.userId ||
    !Number.isSafeInteger(operation.expectedGeneration) ||
    operation.expectedGeneration < 0
  )
    throw new Error('AUTH_WORKFORCE_OPERATION_INVALID')
  const user: Row | null = await ctx.db
    .query('user')
    .withIndex('id', (query) => query.eq('id', operation.userId))
    .unique()
  if (
    !user ||
    user.emailVerified !== true ||
    user.bcnSecurityGeneration !== operation.expectedGeneration
  )
    throw new Error('AUTH_WORKFORCE_SIGN_IN_STATE_CHANGED')
  return user
}

/** Only the reserved primary challenge carries the first-factor generation. */
export async function prepareWorkforceVerificationCreate(
  ctx: Ctx,
  row: Row,
  operation: WorkforceOperation | undefined,
): Promise<Row> {
  assertGenericVerificationWrite(null, row)
  if (operation?.operation !== 'password-challenge') {
    return { ...row, bcnAssuranceGeneration: null }
  }
  const user = await currentUser(ctx, operation)
  if (
    row.id !== operation.challengeId ||
    row.value !== operation.userId ||
    user.twoFactorEnabled !== true ||
    !positive(row.expiresAt) ||
    row.expiresAt <= Date.now()
  )
    throw new Error('AUTH_WORKFORCE_PASSWORD_CHALLENGE_INVALID')
  return { ...row, bcnAssuranceGeneration: operation.expectedGeneration }
}

/** Called in the same mutation as insert; provider data never sets assurance. */
export async function prepareWorkforceSessionCreate(
  ctx: Ctx,
  row: Row,
  operation: WorkforceOperation | undefined,
  receipt?: Readonly<WorkforceConsumedChallenge>,
): Promise<Row> {
  const now = Date.now()
  if (
    !operation ||
    row.userId !== operation.userId ||
    typeof row.id !== 'string' ||
    !row.id ||
    !positive(row.expiresAt) ||
    row.expiresAt <= now
  )
    throw new Error('AUTH_WORKFORCE_SESSION_OPERATION_REQUIRED')
  if (operation.operation === 'confirm-enrollment') {
    if (receipt) throw new Error('AUTH_WORKFORCE_UNEXPECTED_CHALLENGE_RECEIPT')
    return prepareWorkforceEnrollmentSession(ctx, row, operation)
  }
  if (
    operation.operation !== 'password-sign-in' &&
    operation.operation !== 'totp-sign-in' &&
    operation.operation !== 'recovery-sign-in'
  )
    throw new Error('AUTH_WORKFORCE_SESSION_OPERATION_REQUIRED')
  const user = await currentUser(ctx, operation)
  let generation = operation.expectedGeneration
  let method: 'password-only' | 'password-totp' | 'password-recovery' = 'password-only'
  if (operation.operation === 'password-sign-in') {
    if (receipt) throw new Error('AUTH_WORKFORCE_UNEXPECTED_CHALLENGE_RECEIPT')
  } else {
    if (
      !receipt ||
      receipt.operation !== operation.operation ||
      receipt.userId !== operation.userId ||
      receipt.challengeId !== operation.challengeId ||
      !receipt.challengeId ||
      receipt.expectedGeneration !== generation ||
      !positive(receipt.expiresAt) ||
      receipt.expiresAt <= now ||
      user.twoFactorEnabled !== true
    )
      throw new Error('AUTH_WORKFORCE_CHALLENGE_RECEIPT_REQUIRED')
    const factor: Row | null = await ctx.db
      .query('twoFactor')
      .withIndex('userId', (query) => query.eq('userId', operation.userId))
      .unique()
    const challenge = await ctx.db
      .query('verification')
      .withIndex('id', (query) => query.eq('id', operation.challengeId))
      .unique()
    if (
      challenge ||
      factor?.verified !== true ||
      typeof factor.secret !== 'string' ||
      !factor.secret
    )
      throw new Error('AUTH_WORKFORCE_SECOND_FACTOR_STATE_INVALID')
    if (operation.operation === 'recovery-sign-in') {
      // Invalidate existing full sessions only once the provider reaches its
      // successful create path, not when it merely consumes a primary challenge.
      generation = await advanceWorkforceGeneration(ctx, operation.userId)
      method = 'password-recovery'
    } else {
      if (!operation.replay || typeof factor.id !== 'string')
        throw new Error('AUTH_WORKFORCE_REPLAY_PROOF_REQUIRED')
      await consumeWorkforceTotpReplay(ctx, operation.replay, {
        userId: operation.userId,
        factorId: factor.id,
        factorSecret: factor.secret,
      })
      method = 'password-totp'
    }
  }
  return {
    ...row,
    bcnAssuranceGeneration: generation,
    bcnAssuranceMethod: method,
    bcnAuthenticatedAt: now,
    bcnSessionStartedAt: now,
    expiresAt: Math.min(row.expiresAt, now + workforceSessionPolicy.idleTimeoutMs),
  }
}
