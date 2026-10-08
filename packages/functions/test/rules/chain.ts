import type { GenericDatabaseReader } from 'convex/server'
import { v } from 'convex/values'

import { query } from './fns'

/** One random way to read the projects table, as the query fuzz builds it. */
export interface Chain {
  /** `by_org` with this org, a full table scan, or the plain table. */
  source: { orgId: string } | 'fullTableScan' | 'table'
  order: 'asc' | 'desc' | null
  /** Before or after `order`, as Convex allows both. */
  filter: { field: 'orgId' | 'archived'; value: string | boolean; beforeOrder: boolean } | null
  read:
    | { how: 'collect' | 'first' | 'unique' }
    | { how: 'take'; n: number }
    | { how: 'paginate'; numItems: number; cursor: string | null }
    | { how: 'forAwait'; stopAfter: number }
}

/** Runs the chain on any `ctx.db`: the guarded one in `run`, the raw one in the test's oracle. */
export async function runChain(db: GenericDatabaseReader<any>, chain: Chain): Promise<unknown> {
  const table = db.query('projects')
  let q: any =
    chain.source === 'table'
      ? table
      : chain.source === 'fullTableScan'
        ? table.fullTableScan()
        : table.withIndex('by_org', (i: any) => i.eq('orgId', (chain.source as any).orgId))
  const filter = () => {
    const f = chain.filter!
    q = q.filter((r: any) => r.eq(r.field(f.field), f.value))
  }
  if (chain.filter?.beforeOrder) filter()
  if (chain.order) q = q.order(chain.order)
  if (chain.filter && !chain.filter.beforeOrder) filter()
  const { read } = chain
  switch (read.how) {
    case 'collect':
      return q.collect()
    case 'first':
      return q.first()
    case 'unique':
      return q.unique()
    case 'take':
      return q.take(read.n)
    case 'paginate':
      return q.paginate({ numItems: read.numItems, cursor: read.cursor })
    case 'forAwait': {
      const rows = []
      for await (const row of q) {
        rows.push(row)
        if (rows.length === read.stopAfter) break
      }
      return rows
    }
  }
}

/** Reads projects through the chain, with the rules applied. */
export const run = query({
  action: 'projects.read',
  args: { chain: v.any() },
  returns: v.any(),
  handler: async (ctx, { chain }) => runChain(ctx.db, chain as Chain),
})
