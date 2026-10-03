import { hash } from 'ohash'
import { computed, toValue, type ComputedRef, type MaybeRef, type MaybeRefOrGetter } from 'vue'

import { deepUnref } from './deep-unref'

export type ConvexSkipArg = 'skip'
export type ConvexArgs<Args> = Args | ConvexSkipArg

/**
 * Arguments whose top-level fields may be refs; {@link normalizeConvexArgs}
 * unwraps them. A `never` field (exact-empty args) stays `never`, so `{}`
 * queries still reject unknown keys.
 */
export type MaybeRefFields<Args> = {
  [Key in keyof Args]: Args[Key] | ([Args[Key]] extends [never] ? never : MaybeRef<Args[Key]>)
}

export function normalizeConvexArgs<Args>(
  args: MaybeRefOrGetter<ConvexArgs<MaybeRefFields<Args>>>,
): ConvexArgs<Args> {
  const rawArgs = toValue(args)
  if (rawArgs === null || rawArgs === undefined) {
    throw new TypeError(
      '[better-convex-vue] query arguments cannot be null or undefined; pass {} or the literal "skip"',
    )
  }
  if (rawArgs === 'skip') return 'skip'

  // deepUnref replaces every ref with its value, which turns MaybeRefFields<Args> into Args.
  return deepUnref(rawArgs) as unknown as Args
}

export function isConvexArgsSkipped(args: unknown): boolean {
  return args === 'skip'
}

/** Normalized reactive arguments and their stable hash, computed once per change. */
export interface ConvexArgsState<Args> {
  readonly args: ComputedRef<ConvexArgs<Args>>
  readonly hash: ComputedRef<string>
}

export function createConvexArgsState<Args>(
  source: MaybeRefOrGetter<ConvexArgs<MaybeRefFields<Args>>>,
): ConvexArgsState<Args> {
  const args = computed(() => normalizeConvexArgs<Args>(source))
  return { args, hash: computed(() => hash(args.value)) }
}
