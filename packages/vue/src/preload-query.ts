import type { FunctionArgs, FunctionReference } from 'convex/server'
import { effectScope, type MaybeRefOrGetter } from 'vue'

import { createConvexArgsState } from './internal/query-args'
import {
  useConvexQueryInternal,
  type ConvexQueryArgs,
  type UseConvexQueryOptions,
  type UseConvexQueryParameters,
} from './use-query'

export type PreloadConvexQueryOptions = Pick<UseConvexQueryOptions, 'auth'>

/** How long a preloaded subscription stays open for the page that reads it. */
export const PRELOAD_HOLD_MS = 5_000

/**
 * Open a query's subscription before a page needs it and wait for its first
 * result or error. A `useConvexQuery` with the same function, arguments and
 * `auth` then starts with that result instead of `pending`. Never rejects for
 * a query failure: the page's own query reports it.
 *
 * Call it where Vue can inject the plugin: in component setup, in a Vue
 * Router guard, or inside `app.runWithContext()`.
 */
export async function preloadConvexQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  ...parameters: UseConvexQueryParameters<Query, PreloadConvexQueryOptions>
): Promise<void> {
  const [providedArgs, options] = parameters
  const args = (parameters.length === 0 ? {} : providedArgs) as MaybeRefOrGetter<
    ConvexQueryArgs<FunctionArgs<Query>>
  >
  // Detached, so the subscription outlives the guard or component that preloads.
  const scope = effectScope(true)
  try {
    const state = scope.run(() =>
      useConvexQueryInternal({ query, args: createConvexArgsState(args), options }),
    )!
    await state.execute()
  } finally {
    setTimeout(() => scope.stop(), PRELOAD_HOLD_MS)
  }
}
