import { createError, defineEventHandler, getQuery } from 'nuxt/server'

import { api } from '#convex/api'
import { serverConvex } from '#convex/server'

function readLimit(value: unknown): number {
  if (value === undefined) return 5
  if (typeof value !== 'string') {
    throw createError({ status: 400, statusText: 'limit must be an integer from 1 to 50' })
  }

  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || String(limit) !== value) {
    throw createError({ status: 400, statusText: 'limit must be an integer from 1 to 50' })
  }
  return limit
}

/**
 * Test API endpoint that demonstrates server-side queries using serverConvex.
 *
 * This endpoint fetches notes using the Convex query from the server.
 * It shows how you can use serverConvex in API routes or server middleware.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = readLimit(query.limit)

  try {
    // Use the new serverConvex caller!
    // This is the key feature being tested - server-side queries
    const notes = await serverConvex(event).query(api.notes.list)

    // Take only the requested limit
    const limitedNotes = notes.slice(0, limit)

    return {
      success: true,
      count: limitedNotes.length,
      totalAvailable: notes.length,
      notes: limitedNotes,
      executedOn: 'server',
      timestamp: new Date().toISOString(),
    }
  } catch {
    throw createError({ status: 502, statusText: 'Failed to fetch notes' })
  }
})
