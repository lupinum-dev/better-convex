import { toValue, type MaybeRefOrGetter } from 'vue'

import { deepUnref } from './deep-unref'

export type ConvexSkipArg = 'skip'
export type ConvexArgs<Args> = Args | ConvexSkipArg

export function normalizeConvexArgs<Args>(
  args: MaybeRefOrGetter<ConvexArgs<Args>>,
): ConvexArgs<Args> {
  const rawArgs = toValue(args)
  if (rawArgs === null || rawArgs === undefined) {
    throw new TypeError(
      '[better-convex-vue] query arguments cannot be null or undefined; pass {} or the literal "skip"',
    )
  }
  if (rawArgs === 'skip') return rawArgs

  return deepUnref(rawArgs) as Args
}

export function isConvexArgsSkipped(args: unknown): boolean {
  return args === 'skip'
}
