import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

import type { Doc } from './_generated/dataModel'
import { mutation, query } from './_generated/server'

// Public notes - no auth required (for demo purposes).
// DEMO ONLY, DO NOT COPY: anyone can add and delete any note, and the table has no owner.
// For real data, store `ownerId` and check it with `auth.requireUser`, as `tasks.ts` does.

function publicNote(note: Doc<'notes'>) {
  return {
    _id: note._id,
    _creationTime: note._creationTime,
    title: note.title,
    content: note.content,
    createdAt: note.createdAt,
  }
}

function requirePageSize(numItems: number) {
  if (!Number.isInteger(numItems) || numItems < 1 || numItems > 50) {
    throw new Error('Page size must be an integer from 1 to 50')
  }
}

// Get all notes (public)
export const list = query({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db.query('notes').order('desc').take(50)

    return notes.map(publicNote)
  },
})

// Get notes with pagination (public) - descending order (newest first)
export const listPaginated = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    requirePageSize(args.paginationOpts.numItems)
    const result = await ctx.db.query('notes').order('desc').paginate(args.paginationOpts)

    return {
      ...result,
      page: result.page.map(publicNote),
    }
  },
})

// Get notes with pagination - ascending order (oldest first)
export const listPaginatedAsc = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    requirePageSize(args.paginationOpts.numItems)
    const result = await ctx.db.query('notes').order('asc').paginate(args.paginationOpts)

    return {
      ...result,
      page: result.page.map(publicNote),
    }
  },
})

// Get a single note by ID (public)
export const get = query({
  args: { id: v.id('notes') },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.id)
    if (!note) return null
    return publicNote(note)
  },
})

// Search notes by content (public)
export const search = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const searchTerm = args.query.trim()
    if (!searchTerm) {
      return []
    }
    if (searchTerm.length > 100) throw new Error('Search query must be 100 characters or less')

    const notes = await ctx.db.query('notes').order('desc').take(100)
    const lowerQuery = searchTerm.toLowerCase()

    return notes
      .filter(
        (note) =>
          note.title.toLowerCase().includes(lowerQuery) ||
          note.content.toLowerCase().includes(lowerQuery),
      )
      .slice(0, 50)
      .map(publicNote)
  },
})

// Add a new note (public for demo: no auth, no owner, no row limit)
export const add = mutation({
  args: {
    title: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const title = args.title.trim()
    const content = args.content.trim()
    if (!title || title.length > 120) {
      throw new Error('Title must be between 1 and 120 characters')
    }
    if (!content || content.length > 5_000) {
      throw new Error('Content must be between 1 and 5000 characters')
    }
    const noteId = await ctx.db.insert('notes', {
      title,
      content,
      createdAt: Date.now(),
    })
    return noteId
  },
})

// Delete a note. DEMO ONLY: anyone can delete any note. A real feature checks the owner first.
export const remove = mutation({
  args: { id: v.id('notes') },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id)
  },
})

// Get all notes with artificial delay (for testing loading states)
export const listDelayed = query({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db.query('notes').order('desc').take(50)
    return notes.map(publicNote)
  },
})
