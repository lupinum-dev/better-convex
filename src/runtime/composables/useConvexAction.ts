import type { UseConvexCall } from '@lupinum/better-convex-vue'
import { useConvexActionInternal } from '@lupinum/better-convex-vue/internal'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { getFunctionName } from 'convex/server'

import { useNuxtApp } from '#imports'

import { readConvexRuntimeContext } from '../runtime-context'
import { createCallableDevtoolsEvents } from '../utils/callable-devtools'

/** Nuxt auto-import facade over the one shared Vue callable lifecycle. */
export function useConvexAction<Action extends FunctionReference<'action'>>(
  action: Action,
): UseConvexCall<Action> {
  const runtime = readConvexRuntimeContext(useNuxtApp())
  const observer = createCallableDevtoolsEvents<FunctionArgs<Action>, FunctionReturnType<Action>>({
    operation: 'action',
    fnName: getFunctionName(action),
    hasOptimisticUpdate: false,
    getSink: () => runtime?.getDevtoolsSink() ?? null,
  })
  return useConvexActionInternal(action, { observer })
}
