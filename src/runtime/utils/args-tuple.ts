import type { FunctionReference } from 'convex/server'
import type { MaybeRefOrGetter } from 'vue'

type StrictEmptyArgs = Record<PropertyKey, never>
/**
 * Tighten *only* an exactly-empty args object (`{}`, i.e. no declared keys) to
 * `Record<PropertyKey, never>` so callers cannot smuggle arbitrary properties
 * into a no-arg function. All-optional args objects like `{ limit?: number }`
 * have declared keys (`keyof` is not `never`) and are left untouched, so they
 * stay callable with `{ limit: 5 }`.
 *
 * The `T extends unknown` wrapper forces distribution over union args (from a
 * top-level `v.union(...)` validator) so each member is judged by its own
 * keys — without it, `keyof (A | B)` is the key *intersection*, which is
 * `never` for disjoint members and would wrongly collapse the whole union to
 * the empty-args type.
 *
 * This tightening is private to the client composable contract. The server
 * caller follows Convex's native `OptionalRestArgs` behavior instead.
 */
type TightenEmptyArgs<T> = T extends unknown ? (keyof T extends never ? StrictEmptyArgs : T) : never
type TightenEmptyArgsParam<T> =
  T extends MaybeRefOrGetter<infer Value> ? MaybeRefOrGetter<TightenEmptyArgs<Value>> : T

/**
 * The client `(args, options)` call shape (decision 9). The args
 * slot is ALWAYS required and positional — even a no-argument Convex function
 * must be called with `{}`. A truly empty args object is tightened to
 * `Record<PropertyKey, never>` so an options-shaped object can never occupy the
 * args slot; all-optional and union-optional args are left callable.
 *
 * `ArgsObject` is retained for call-site symmetry (paginated composables strip
 * `paginationOpts` before passing it) but no longer selects optionality — the
 * args slot is unconditionally required. `ArgsParam` is what the caller passes
 * (often `MaybeRefOrGetter`); `Options` is the trailing options object.
 */
export type ConvexQueryRest<_ArgsObject, ArgsParam, Options> = [
  args: TightenEmptyArgsParam<ArgsParam>,
  options?: Options,
]

/**
 * The always-required `args` field for object-config composables
 * (`defineSharedConvexQuery`). A no-argument query must still declare `args: {}`.
 */
export type SharedQueryArgsField<_Query extends FunctionReference<'query'>, Args> = {
  args: MaybeRefOrGetter<TightenEmptyArgs<Args>>
}
