import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png'])
const IMAGE_POLICY_MESSAGE = 'File must be a GIF, JPEG, or PNG no larger than 5 MB'

/**
 * Generate a signed upload URL for file storage.
 * This is required by useConvexFileUpload.
 *
 * Requires authentication - anonymous callers cannot mint upload URLs.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error('Not authenticated')
    }

    return await ctx.storage.generateUploadUrl()
  },
})

/**
 * Record ownership of an uploaded file. Call this with the storageId returned
 * by `upload()` right after a successful upload - `getUrl`/`deleteFile` only
 * resolve/act on files with a recorded owner.
 */
export const saveFile = mutation({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error('Not authenticated')
    }

    // First registration wins: without this, a second insert for the same
    // storageId would let another caller contest ownership and would make the
    // `.unique()` lookups in getUrl/deleteFile throw.
    const existing = await ctx.db
      .query('files')
      .withIndex('by_storage', (q) => q.eq('storageId', args.storageId))
      .unique()
    if (existing) {
      throw new Error('File already registered')
    }

    // Browser-provided metadata is only an early UX check. The storage row is
    // the canonical record of the bytes Convex accepted.
    const stored = await ctx.db.system.get('_storage', args.storageId)
    if (!stored) {
      return {
        status: 'rejected' as const,
        reason: 'not_found' as const,
        message: 'Uploaded file was not found',
      }
    }

    const contentType = stored.contentType?.toLowerCase()
    if (
      stored.size > MAX_IMAGE_SIZE_BYTES ||
      !contentType ||
      !ALLOWED_IMAGE_TYPES.has(contentType)
    ) {
      // Return instead of throwing: Convex rolls back mutation writes on a
      // thrown error, including this cleanup deletion.
      await ctx.storage.delete(args.storageId)
      return {
        status: 'rejected' as const,
        reason: 'invalid_file' as const,
        message: IMAGE_POLICY_MESSAGE,
      }
    }

    const fileId = await ctx.db.insert('files', {
      storageId: args.storageId,
      ownerId: identity.subject,
      createdAt: Date.now(),
    })

    return { status: 'registered' as const, fileId }
  },
})

/** Get a signed URL for a file in storage when requested by its owner. */
export const getUrl = query({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return null
    }

    const file = await ctx.db
      .query('files')
      .withIndex('by_storage', (q) => q.eq('storageId', args.storageId))
      .unique()

    if (!file || file.ownerId !== identity.subject) {
      return null
    }

    return await ctx.storage.getUrl(args.storageId)
  },
})

/**
 * Delete a file from storage.
 *
 * Only the file's owner can delete it.
 */
export const deleteFile = mutation({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error('Not authenticated')
    }

    const file = await ctx.db
      .query('files')
      .withIndex('by_storage', (q) => q.eq('storageId', args.storageId))
      .unique()

    if (!file || file.ownerId !== identity.subject) {
      throw new Error('Not authorized')
    }

    await ctx.db.delete(file._id)
    await ctx.storage.delete(args.storageId)
  },
})
