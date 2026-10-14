import type { FunctionArgs, FunctionReference } from 'convex/server'
import { effectScope, hasInjectionContext, type MaybeRefOrGetter } from 'vue'

import { createConvexArgsState } from './internal/query-args'
import {
  useConvexQueryInternal,
  type ConvexQueryArgs,
  type UseConvexQueryOptions,
  type UseConvexQueryParameters,
} from './use-query'

export type PreloadConvexQueryOptions = Pick<UseConvexQueryOptions, 'auth'>

/**
 * How long a preload waits for the first result, and how long its
 * subscription then stays open for the page that reads it.
 */
export const PRELOAD_HOLD_MS = 5_000

/**
 * Open a query's subscription before a page needs it and wait for its first
 * result or error, at most `PRELOAD_HOLD_MS`. A `useConvexQuery` with the same
 * function, arguments and `auth` then starts with a successful result instead
 * of `pending`. Never rejects for a query failure: the page's own query
 * reports it.
 *
 * Call it where Vue can inject the plugin: in component setup, in a Vue
 * Router guard before its first `await`, or inside `app.runWithContext()`.
 */
export async function preloadConvexQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  ...parameters: UseConvexQueryParameters<Query, PreloadConvexQueryOptions>
): Promise<void> {
  if (!hasInjectionContext()) {
    throw new Error(
      '[better-convex-vue] preloadConvexQuery needs the Vue app context. Call it in setup, before the first await of a router guard, or inside app.runWithContext()',
    )
  }
  const [providedArgs, options] = parameters
  const args = (parameters.length === 0 ? {} : providedArgs) as MaybeRefOrGetter<
    ConvexQueryArgs<FunctionArgs<Query>>
  >
  // Detached, so the subscription outlives the guard or component that preloads.
  const scope = effectScope(true)
  let waitLimit: ReturnType<typeof setTimeout> | undefined
  try {
    const state = scope.run(() =>
      useConvexQueryInternal({ query, args: createConvexArgsState(args), options }),
    )!
    // Offline or unsettled auth must not hold a navigation; the page then loads normally.
    await Promise.race([
      state.execute(),
      new Promise<void>((resolve) => {
        waitLimit = setTimeout(resolve, PRELOAD_HOLD_MS)
      }),
    ])
  } finally {
    clearTimeout(waitLimit)
    setTimeout(() => scope.stop(), PRELOAD_HOLD_MS)
  }
}
