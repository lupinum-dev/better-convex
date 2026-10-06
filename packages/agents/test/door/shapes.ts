import { v } from 'convex/values'

import { query } from './fns'

/** E8: every validator kind JSON can carry, as one tool. Echoes what arrived. */
export const echo = query({
  action: 'shapes.echo',
  args: {
    text: v.optional(v.string()),
    kind: v.optional(v.union(v.literal('a'), v.literal('b'))),
    either: v.optional(v.union(v.string(), v.number())),
    tags: v.optional(v.record(v.string(), v.number())),
    nested: v.optional(
      v.object({ inner: v.object({ flag: v.boolean(), note: v.optional(v.string()) }) }),
    ),
    list: v.optional(v.array(v.id('projects'))),
    nothing: v.optional(v.null()),
    anything: v.optional(v.any()),
  },
  returns: v.any(),
  tool: {
    name: 'echo_shapes',
    description: 'Echo the arguments.',
    args: { list: 'Project IDs.' },
  },
  handler: async (_ctx, args) => ({
    types: Object.fromEntries(Object.entries(args).map(([k, value]) => [k, typeof value])),
  }),
})
