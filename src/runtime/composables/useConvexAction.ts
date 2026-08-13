import {
  useConvexAction as useVueConvexAction,
  type UseConvexCall,
} from '@lupinum/better-convex-vue'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { getFunctionName } from 'convex/server'

import { useNuxtApp } from '#imports'

import { readConvexRuntimeContext } from '../runtime-context'
import { createCallableDevtoolsEvents } from '../utils/callable-devtools'
import { CALLABLE_OBSERVER_KEY } from '../utils/callable-observer'

/** Nuxt auto-import facade over the one shared Vue callable lifecycle. */
export function useConvexAction<Action extends FunctionReference<'action'>>(
  action: Action,
): UseConvexCall<Action> {
  const runtime = readConvexRuntimeContext(useNuxtApp())
  const events = createCallableDevtoolsEvents<FunctionArgs<Action>, FunctionReturnType<Action>>({
    operation: 'action',
    fnName: getFunctionName(action),
    hasOptimisticUpdate: false,
    getSink: () => runtime?.getDevtoolsSink() ?? null,
  })
  return (
    useVueConvexAction as unknown as (
      reference: Action,
      options: Record<PropertyKey, unknown>,
    ) => UseConvexCall<Action>
  )(action, { [CALLABLE_OBSERVER_KEY]: events })
}
