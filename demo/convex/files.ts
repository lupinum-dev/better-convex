/**
 * Files Functions - Storage demo
 *
 * Demonstrates file uploads with useConvexFileUpload and an ordinary URL query.
 */

import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png'])
const MAX_FILENAME_LENGTH = 255

function normalizeFilename(filename: string) {
  const normalized = filename.trim()
  if (
    !normalized ||
    normalized.length > MAX_FILENAME_LENGTH ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
  ) {
    throw new Error('Filename must be 1-255 visible characters')
  }
  return normalized
}

/**
 * Generate a URL for uploading a file
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
 * Save file metadata after upload
 */
export const save = mutation({
  args: {
    storageId: v.id('_storage'),
    filename: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error('Not authenticated')
    }

    const existing = await ctx.db
      .query('files')
      .withIndex('by_storage', (q) => q.eq('storageId', args.storageId))
      .unique()
    if (existing) {
      throw new Error('File is already registered')
    }

    const metadata = await ctx.db.system.get('_storage', args.storageId)
    if (!metadata) {
      throw new Error('Uploaded file was not found')
    }
    if (metadata.size > MAX_FILE_SIZE) {
      throw new Error('File size must be less than 5MB')
    }
    if (!metadata.contentType || !ALLOWED_TYPES.has(metadata.contentType.toLowerCase())) {
      throw new Error('Only GIF, JPEG, and PNG images are allowed')
    }
    const filename = normalizeFilename(args.filename)

    const fileId = await ctx.db.insert('files', {
      storageId: args.storageId,
      filename,
      mimeType: metadata.contentType,
      size: metadata.size,
      uploadedBy: identity.subject,
      createdAt: Date.now(),
    })

    return fileId
  },
})

/**
 * Get a URL to access a stored file
 */
export const getUrl = query({
  args: {
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return null
    }

    const file = await ctx.db
      .query('files')
      .withIndex('by_storage', (q) => q.eq('storageId', args.storageId))
      .unique()
    if (!file || file.uploadedBy !== identity.subject) {
      return null
    }

    return await ctx.storage.getUrl(args.storageId)
  },
})

/**
 * List all uploaded files with uploader info
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return []
    }
    const files = await ctx.db
      .query('files')
      .withIndex('by_uploaded_by', (q) => q.eq('uploadedBy', identity.subject))
      .order('desc')
      .take(50)

    // Fetch uploader info for each file
    const filesWithUploader = await Promise.all(
      files.map(async (file) => {
        const uploader = await ctx.db
          .query('users')
          .withIndex('by_auth_id', (q) => q.eq('authId', file.uploadedBy))
          .first()

        return {
          ...file,
          uploaderName: uploader?.displayName || uploader?.email || 'Unknown',
          uploaderAvatarUrl: uploader?.avatarUrl,
        }
      }),
    )

    return filesWithUploader
  },
})

/**
 * Delete a file
 */
export const remove = mutation({
  args: {
    id: v.id('files'),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error('Not authenticated')
    }

    const file = await ctx.db.get(args.id)
    if (!file) {
      throw new Error('File not found')
    }

    const isOwner = file.uploadedBy === identity.subject

    if (!isOwner) {
      throw new Error('Not authorized to delete this file')
    }

    // Delete from storage
    await ctx.storage.delete(file.storageId)

    // Delete metadata
    await ctx.db.delete(args.id)
  },
})
