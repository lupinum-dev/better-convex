import type { GenericId } from 'convex/values'

import { actorRecord, fail } from './actor'
import { callOf } from './functions'

/**
 * File types an upload link can take. The upload route decides the type from
 * the file's first bytes, never from a name or a header: `%PDF-` for a PDF,
 * the PNG, JPEG and WebP signatures, and for CSV, UTF-8 text without control
 * characters other than tab and line breaks.
 */
export const uploadTypes = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/csv',
] as const
export type UploadType = (typeof uploadTypes)[number]

/** Convex reads an HTTP action's request up to about 20 MB; a link never takes more. */
export const maximumUploadBytes = 20 * 1024 * 1024
/** A link takes its file within this time. */
export const uploadLinkMs = 15 * 60_000
/** A stored file waits this long for a claim, then housekeeping deletes it. */
export const uploadClaimMs = 24 * 60 * 60_000
/** A claimed row stays this long for the record; the file itself belongs to the app. */
export const uploadRecordMs = 30 * 24 * 60 * 60_000

/** What a claim hands the app: the stored file and what the route found out about it. */
export interface ClaimedUpload {
  storageId: GenericId<'_storage'>
  type: UploadType
  size: number
  /** SHA-256 of the bytes, hex: the same file sent twice has the same value. */
  sha256: string
}

/**
 * Takes a file the calling actor uploaded through a one-time link
 * (`request_upload` in `@lupinum/better-convex-agents`), so the app can store
 * its `storageId` in a row. Call it inside a mutation operation of
 * `defineFunctions`, in the same transaction as the write that stores the ID.
 *
 * A storage ID from input is a key to someone's file (see the threat model).
 * An upload ID is not: the claim passes only for the actor who asked for the
 * link (the same person, or the same agent connection), only once, and only
 * for a file whose type (from its first bytes) and size the caller allows.
 * A missing, foreign or already claimed upload fails the same way, with
 * `NOT_FOUND`; a type or size the caller does not allow fails with
 * `INVALID_INPUT`, and the file stays claimable for another call.
 *
 * Cost: reads and writes one `uploads` row.
 */
/** Upload IDs claimed so far in each transaction, keyed by its database. */
const claimingIn = new WeakMap<object, Set<string>>()

export async function claimUpload(
  ctx: { db: { patch: (...args: never[]) => unknown } },
  uploadId: string,
  allowed: { types: readonly UploadType[]; maxBytes: number },
): Promise<ClaimedUpload> {
  const call = callOf(ctx.db)
  if (!call) {
    throw new Error(
      'claimUpload runs inside a mutation operation of defineFunctions: pass the ctx of its handler.',
    )
  }
  if (!Array.isArray(allowed.types) || allowed.types.length === 0) {
    throw new Error('claimUpload: name the file types this write takes in `types`.')
  }
  if (!Number.isSafeInteger(allowed.maxBytes) || allowed.maxBytes <= 0) {
    throw new Error('claimUpload: `maxBytes` must be a positive whole number of bytes.')
  }
  const { db, actor } = call
  const notFound = () => fail('NOT_FOUND', 'No upload with this ID is waiting for this caller.')
  if (actor.kind === 'visitor') notFound()
  const id = typeof uploadId === 'string' ? db.normalizeId('uploads', uploadId) : null
  if (!id) return notFound()
  // Marked before the first await: two claims of one upload in one transaction
  // would otherwise both read `stored` and both pass.
  let claiming = claimingIn.get(db)
  if (!claiming) claimingIn.set(db, (claiming = new Set()))
  if (claiming.has(id)) return notFound()
  claiming.add(id)
  const row = await db.get(id)
  if (
    !row ||
    row.status !== 'stored' ||
    row.expiresAt <= Date.now() ||
    row.owner.key !== actorRecord(actor as Exclude<typeof actor, { kind: 'visitor' }>).key ||
    !row.storageId ||
    !row.type ||
    row.size === undefined ||
    !row.sha256
  ) {
    return notFound()
  }
  if (!(allowed.types as readonly string[]).includes(row.type)) {
    fail(
      'INVALID_INPUT',
      `This file is ${row.type}; this action takes ${allowed.types.join(', ')}.`,
    )
  }
  if (row.size > allowed.maxBytes) {
    fail(
      'INVALID_INPUT',
      `This file has ${row.size} bytes; this action takes at most ${allowed.maxBytes}.`,
    )
  }
  await db.patch(row._id, { status: 'claimed', expiresAt: Date.now() + uploadRecordMs })
  return {
    storageId: row.storageId,
    type: row.type as UploadType,
    size: row.size,
    sha256: row.sha256,
  }
}
