import { getConvexSize, type Value } from 'convex/values'

/**
 * What one background step reads at most, about: far inside Convex's limits
 * (16 MiB and 32,000 documents), even when every row is near the 1 MiB
 * document limit. A step checks the budget before each read, so it may go
 * over by the documents of one read step (at most a few MiB). The same idea as
 * the agents package's housekeeping budget; the packages do not import each other.
 */
export const sweep = { rows: 100, bytes: 4 * 1024 * 1024 }

export function readBudget() {
  let rows = sweep.rows
  let bytes = sweep.bytes
  return {
    count(row: object) {
      rows -= 1
      bytes -= getConvexSize(row as Value)
    },
    get spent() {
      return rows <= 0 || bytes <= 0
    },
  }
}
export type Budget = ReturnType<typeof readBudget>

/** Reads `query` until it ends or the budget is spent. `more`: rows may remain. */
export async function within<T extends Record<string, unknown>>(
  query: AsyncIterable<T>,
  budget: Budget,
) {
  const rows: T[] = []
  if (budget.spent) return { rows, more: true }
  for await (const row of query) {
    rows.push(row)
    budget.count(row)
    if (budget.spent) return { rows, more: true }
  }
  return { rows, more: false }
}
