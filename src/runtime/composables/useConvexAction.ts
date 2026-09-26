import type { UseConvexActionReturn } from '@lupinum/better-convex-vue'
import { useConvexActionInternal } from '@lupinum/better-convex-vue/internal'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { getFunctionName } from 'convex/server'

import { useNuxtApp } from '#imports'

import { readConvexRuntimeContext } from '../runtime-context'
import { createCallableDevtoolsEvents } from '../utils/callable-devtools'

/**
 * Binds a Convex action to reactive call state. Nuxt auto-import facade over
 * the shared Vue callable lifecycle; it adds only DevTools observation.
 *
 * ```ts
 * const { run, pending, error } = useConvexAction(api.reports.generate)
 * await run({ month: '2026-09' })
 * ```
 */
export function useConvexAction<Action extends FunctionReference<'action'>>(
  action: Action,
): UseConvexActionReturn<Action> {
  const runtime = readConvexRuntimeContext(useNuxtApp())
  const observer = createCallableDevtoolsEvents<FunctionArgs<Action>, FunctionReturnType<Action>>({
    operation: 'action',
    fnName: getFunctionName(action),
    hasOptimisticUpdate: false,
    getSink: () => runtime?.getDevtoolsSink() ?? null,
  })
  return useConvexActionInternal(action, { observer })
}
