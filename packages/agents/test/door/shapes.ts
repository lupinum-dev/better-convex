import { v } from 'convex/values'

import { query } from './fns'

/**
 * E8: every validator kind JSON can carry, as one tool. Echoes what arrived. The text "crash"
 * throws a plain Error, as a bug in app code does. "NaN" and "bigint" return a value Convex
 * carries but JSON does not.
 */
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
  handler: async (_ctx, args) => {
    if (args.text === 'crash') throw new Error('The handler crashed.')
    if (args.text === 'NaN') return { nan: NaN, infinity: Infinity }
    if (args.text === 'bigint') return { count: 1n }
    return {
      types: Object.fromEntries(Object.entries(args).map(([k, value]) => [k, typeof value])),
    }
  },
})
