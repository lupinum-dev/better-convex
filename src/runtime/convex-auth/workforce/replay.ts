import type { GenericDataModel, GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import { ConvexError } from 'convex/values'

import { fingerprintWorkforceFactor } from './factor-fingerprint'
import type { WorkforceReplayProof } from './operations'

type Row = Record<string, unknown>

export const workforceReplayPolicy = Object.freeze({
  periodMs: 30_000,
  retentionMs: 120_000,
  cleanupBatchSize: 128,
})

const markerPrefix = 'bcn-totp-replay:'
const markerValue = 'bcn-totp-replay'
const digestPattern = /^[\w-]{43}$/u

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function identity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

function reserved(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(markerPrefix)
}

/** Check both fields so a generic patch cannot rename a marker out of its namespace. */
export function isWorkforceReplayMarker(row: Readonly<Row> | null): boolean {
  return row !== null && (reserved(row.id) || reserved(row.identifier))
}

/** Call for verification creates and for both the old and merged updated row. */
export function assertGenericVerificationWrite(
  previous: Readonly<Row> | null,
  next: Readonly<Row>,
): void {
  if (isWorkforceReplayMarker(previous) || isWorkforceReplayMarker(next)) {
    throw new Error('AUTH_WORKFORCE_REPLAY_MARKER_OWNED')
  }
}

/** Ordinary challenge deletion is unchanged; replay markers may only expire. */
export function assertGenericVerificationDelete(row: Readonly<Row>, now = Date.now()): void {
  if (
    isWorkforceReplayMarker(row) &&
    (!positive(now) || !positive(row.expiresAt) || row.expiresAt > now)
  ) {
    throw new Error('AUTH_WORKFORCE_REPLAY_MARKER_OWNED')
  }
}

/**
 * Call only inside the mutation that grants a provider-verified TOTP session or
 * promotes its pending factor, after checking the live user/factor and ceremony.
 * The provider-success receipt remains mandatory at the caller. The indexed
 * absence read and marker write share that caller's transaction and rollback.
 */
export async function consumeWorkforceTotpReplay(
  ctx: GenericMutationCtx<GenericDataModel>,
  proof: Readonly<WorkforceReplayProof>,
  binding: Readonly<{ userId: string; factorId: string; factorSecret: string }>,
): Promise<void> {
  const now = Date.now()
  const counter = Math.floor(now / workforceReplayPolicy.periodMs)
  const counters = proof.matchingCounters
  if (
    !identity(binding.userId) ||
    !identity(binding.factorId) ||
    proof.userId !== binding.userId ||
    proof.factorId !== binding.factorId ||
    !digestPattern.test(proof.digest) ||
    typeof binding.factorSecret !== 'string' ||
    !binding.factorSecret ||
    !/^[0-9a-f]{64}$/u.test(proof.factorFingerprint) ||
    !positive(now) ||
    !Array.isArray(counters) ||
    counters.length < 1 ||
    counters.length > 3 ||
    counters.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    new Set(counters).size !== counters.length ||
    Math.max(...counters) - Math.min(...counters) > 2 ||
    !counters.some((value) => Math.abs(counter - value) <= 1)
  ) {
    throw new Error('AUTH_WORKFORCE_REPLAY_PROOF_INVALID')
  }
  if (proof.factorFingerprint !== (await fingerprintWorkforceFactor(binding.factorSecret))) {
    throw new Error('AUTH_WORKFORCE_REPLAY_PROOF_INVALID')
  }
  // Cover every matched counter, including a six-digit collision between steps.
  // The canonical counter gate rejects delayed evidence; no action-clock bound
  // is assumed. Finite retention cannot cover arbitrary backward clock jumps.
  const expiresAt = Math.max(
    now + workforceReplayPolicy.retentionMs,
    (Math.max(...counters) + 2) * workforceReplayPolicy.periodMs,
  )
  if (!Number.isSafeInteger(expiresAt)) throw new Error('AUTH_WORKFORCE_REPLAY_PROOF_INVALID')
  const identifier = `${markerPrefix}${proof.digest}`
  const existing: Row | null = await ctx.db
    .query('verification')
    .withIndex('identifier', (query) => query.eq('identifier', identifier))
    .unique()
  if (existing) {
    if (
      existing.id !== identifier ||
      existing.value !== markerValue ||
      existing.bcnAssuranceGeneration !== null ||
      !positive(existing.expiresAt)
    ) {
      throw new Error('AUTH_WORKFORCE_REPLAY_MARKER_INVALID')
    }
    if (existing.expiresAt > now) throw new ConvexError('AUTH_WORKFORCE_TOTP_REPLAYED')
    const id =
      typeof existing._id === 'string' ? ctx.db.normalizeId('verification', existing._id) : null
    if (!id) throw new Error('AUTH_WORKFORCE_REPLAY_MARKER_INVALID')
    await ctx.db.delete('verification', id)
  }
  await ctx.db.insert('verification', {
    id: identifier,
    identifier,
    value: markerValue,
    createdAt: now,
    updatedAt: now,
    expiresAt,
    bcnAssuranceGeneration: null,
  })
}

/**
 * One bounded batch, not a sweep or scheduled job. The caller must delete these
 * rows through its existing relationship/trigger engine in the same mutation.
 * Collect all expired verification kinds so ordinary rows cannot starve markers.
 */
export async function collectExpiredWorkforceVerificationRows(
  ctx: GenericQueryCtx<GenericDataModel>,
  callerCutoff = Date.now(),
): Promise<Row[]> {
  const cutoff = Math.min(callerCutoff, Date.now())
  if (
    !Number.isFinite(callerCutoff) ||
    callerCutoff <= 0 ||
    !Number.isFinite(cutoff) ||
    cutoff <= 0
  ) {
    throw new Error('AUTH_WORKFORCE_CLEANUP_CUTOFF_INVALID')
  }
  return ctx.db
    .query('verification')
    .withIndex('expiresAt', (query) => query.lt('expiresAt', cutoff))
    .take(workforceReplayPolicy.cleanupBatchSize)
}
