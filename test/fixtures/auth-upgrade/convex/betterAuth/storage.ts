/*
 * Raw table access inside the auth component, for the upgrade harness only.
 * `insert` stands in for rows a 1.0.0-beta.7 deployment already holds; the
 * backend validates each row against the beta schema deployed at that time.
 * `rows` reads stored documents unchanged, including `_id`.
 */
import { mutationGeneric, queryGeneric } from 'convex/server'
import { v } from 'convex/values'

export const insert = mutationGeneric({
  args: { table: v.string(), rows: v.array(v.any()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const row of args.rows) await ctx.db.insert(args.table as never, row as never)
    return null
  },
})

export const rows = queryGeneric({
  args: { table: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const documents = await ctx.db.query(args.table as never).collect()
    return documents
      .map(({ _creationTime, ...row }: Record<string, unknown>) => row)
      .sort((left, right) => String(left._id).localeCompare(String(right._id)))
  },
})
