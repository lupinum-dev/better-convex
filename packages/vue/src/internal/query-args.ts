import { hash } from 'ohash'
import { computed, toValue, type ComputedRef, type MaybeRef, type MaybeRefOrGetter } from 'vue'

import { deepUnref } from './deep-unref'

export type ConvexSkipArg = 'skip'
export type ConvexArgs<Args> = Args | ConvexSkipArg

/**
 * Query arguments whose top-level fields may each be a ref, for example
 * `{ projectId }` from `toRefs(props)`. `normalizeConvexArgs` unwraps them.
 * `Args` stays a member of its own so generic wrappers can pass it through.
 */
export type ConvexArgsInput<Args> =
  | Args
  | (Args extends Record<PropertyKey, never> ? never : { [Key in keyof Args]: MaybeRef<Args[Key]> })

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

/** Normalized reactive arguments and their stable hash, computed once per change. */
export interface ConvexArgsState<Args> {
  readonly args: ComputedRef<ConvexArgs<Args>>
  readonly hash: ComputedRef<string>
}

export function createConvexArgsState<Args>(
  source: MaybeRefOrGetter<ConvexArgs<Args>>,
): ConvexArgsState<Args> {
  const args = computed(() => normalizeConvexArgs(source))
  return { args, hash: computed(() => hash(args.value)) }
}
