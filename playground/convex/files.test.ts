/**
 * Files (Convex Storage) Tests
 *
 * Backend example for the file-storage docs: verifies
 * generateUploadUrl/getUrl/deleteFile enforce authentication + ownership.
 */

import { signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { describe, it, expect } from 'vitest'

import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { initConvexTest } from './test.setup'

async function storeFile(
  t: ReturnType<typeof initConvexTest>,
  options: { contentType?: string; size?: number } = {},
) {
  const { contentType = 'image/png', size } = options
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(['content'], { type: contentType }))
    // convex-test 0.0.41 omits Blob.type from its synthetic _storage row.
    await (
      ctx.db as unknown as {
        patch: (id: Id<'_storage'>, value: { contentType: string; size?: number }) => Promise<void>
      }
    ).patch(storageId, { contentType, ...(size === undefined ? {} : { size }) })
    return storageId
  })
}

describe('files.generateUploadUrl', () => {
  it('throws for unauthenticated callers', async () => {
    const t = initConvexTest()

    await expect(t.mutation(api.files.generateUploadUrl, {})).rejects.toThrow(
      'Authentication required',
    )
  })

  it('returns an upload URL for authenticated callers', async () => {
    const t = initConvexTest()
    const asUser = await signInAs(t, 'user_1')

    const url = await asUser.mutation(api.files.generateUploadUrl, {})
    expect(typeof url).toBe('string')
  })
})

describe('files.saveFile', () => {
  it('throws for unauthenticated callers', async () => {
    const t = initConvexTest()

    const storageId = await storeFile(t)

    await expect(t.mutation(api.files.saveFile, { storageId })).rejects.toThrow(
      'Authentication required',
    )
  })

  it('records the caller as owner', async () => {
    const t = initConvexTest()
    const asUser = await signInAs(t, 'user_1')

    const storageId = await storeFile(t)
    const result = await asUser.mutation(api.files.saveFile, { storageId })

    const file = await t.run(async (ctx) => {
      return await ctx.db
        .query('files')
        .withIndex('by_storage', (q) => q.eq('storageId', storageId))
        .unique()
    })
    expect(file?.ownerId).toBe('user_1')
    expect(result).toEqual({ status: 'registered', fileId: file?._id })
  })

  it('deletes a blob with a disallowed canonical MIME type and commits the rejection', async () => {
    const t = initConvexTest()
    const asUser = await signInAs(t, 'user_1')
    const storageId = await storeFile(t, { contentType: 'text/html' })

    const result = await asUser.mutation(api.files.saveFile, { storageId })

    expect(result).toEqual({
      status: 'rejected',
      reason: 'invalid_file',
      message: 'File must be a GIF, JPEG, or PNG no larger than 5 MB',
    })
    expect(await t.run(async (ctx) => await ctx.db.system.get('_storage', storageId))).toBeNull()
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query('files')
          .withIndex('by_storage', (q) => q.eq('storageId', storageId))
          .unique(),
      ),
    ).toBeNull()
  })

  it('deletes an oversized blob and commits the rejection', async () => {
    const t = initConvexTest()
    const asUser = await signInAs(t, 'user_1')
    const storageId = await storeFile(t, { size: 5 * 1024 * 1024 + 1 })

    const result = await asUser.mutation(api.files.saveFile, { storageId })

    expect(result).toMatchObject({ status: 'rejected', reason: 'invalid_file' })
    expect(await t.run(async (ctx) => await ctx.db.system.get('_storage', storageId))).toBeNull()
  })

  it('returns a not-found rejection without creating ownership', async () => {
    const t = initConvexTest()
    const asUser = await signInAs(t, 'user_1')
    const storageId = await storeFile(t)
    await t.run(async (ctx) => await ctx.storage.delete(storageId))

    const result = await asUser.mutation(api.files.saveFile, { storageId })

    expect(result).toEqual({
      status: 'rejected',
      reason: 'not_found',
      message: 'Uploaded file was not found',
    })
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query('files')
          .withIndex('by_storage', (q) => q.eq('storageId', storageId))
          .unique(),
      ),
    ).toBeNull()
  })

  it('rejects a second registration of the same storageId (claim-race guard)', async () => {
    const t = initConvexTest()
    const asOwner = await signInAs(t, 'user_owner')
    const asOther = await signInAs(t, 'user_other')

    const storageId = await storeFile(t)
    await asOwner.mutation(api.files.saveFile, { storageId })

    await expect(asOther.mutation(api.files.saveFile, { storageId })).rejects.toThrow(
      'File already registered',
    )

    // Ownership is unchanged - the original owner still resolves the file.
    const url = await asOwner.query(api.files.getUrl, { storageId })
    expect(typeof url).toBe('string')
    expect(
      await t.run(async (ctx) => await ctx.db.system.get('_storage', storageId)),
    ).not.toBeNull()
  })
})

describe('files.getUrl', () => {
  it('returns null for unauthenticated callers', async () => {
    const t = initConvexTest()
    const asOwner = await signInAs(t, 'user_owner')

    const storageId = await storeFile(t)
    await asOwner.mutation(api.files.saveFile, { storageId })

    const url = await t.query(api.files.getUrl, { storageId })
    expect(url).toBeNull()
  })

  it('returns null for a caller who does not own the file', async () => {
    const t = initConvexTest()
    const asOwner = await signInAs(t, 'user_owner')
    const asOther = await signInAs(t, 'user_other')

    const storageId = await storeFile(t)
    await asOwner.mutation(api.files.saveFile, { storageId })

    const url = await asOther.query(api.files.getUrl, { storageId })
    expect(url).toBeNull()
  })

  it('returns null when no ownership record exists yet', async () => {
    const t = initConvexTest()
    const asOwner = await signInAs(t, 'user_owner')

    const storageId = await storeFile(t)
    // saveFile was never called - no owner recorded.

    const url = await asOwner.query(api.files.getUrl, { storageId })
    expect(url).toBeNull()
  })

  it('returns the URL for the owning caller', async () => {
    const t = initConvexTest()
    const asOwner = await signInAs(t, 'user_owner')

    const storageId = await storeFile(t)
    await asOwner.mutation(api.files.saveFile, { storageId })

    const url = await asOwner.query(api.files.getUrl, { storageId })
    expect(typeof url).toBe('string')
  })
})

describe('files.deleteFile', () => {
  it('throws for unauthenticated callers', async () => {
    const t = initConvexTest()
    const asOwner = await signInAs(t, 'user_owner')

    const storageId = await storeFile(t)
    await asOwner.mutation(api.files.saveFile, { storageId })

    await expect(t.mutation(api.files.deleteFile, { storageId })).rejects.toThrow(
      'Authentication required',
    )
  })

  it('throws for a caller who does not own the file (IDOR guard)', async () => {
    const t = initConvexTest()
    const asOwner = await signInAs(t, 'user_owner')
    const asOther = await signInAs(t, 'user_other')

    const storageId = await storeFile(t)
    await asOwner.mutation(api.files.saveFile, { storageId })

    await expect(asOther.mutation(api.files.deleteFile, { storageId })).rejects.toThrow(
      'Not authorized',
    )

    // File must still be resolvable by its owner - the attacker's call had no effect.
    const url = await asOwner.query(api.files.getUrl, { storageId })
    expect(typeof url).toBe('string')
  })

  it('allows the owner to delete their file', async () => {
    const t = initConvexTest()
    const asOwner = await signInAs(t, 'user_owner')

    const storageId = await storeFile(t)
    await asOwner.mutation(api.files.saveFile, { storageId })

    await asOwner.mutation(api.files.deleteFile, { storageId })

    const url = await asOwner.query(api.files.getUrl, { storageId })
    expect(url).toBeNull()
  })
})
