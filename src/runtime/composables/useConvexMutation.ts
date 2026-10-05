import type { UseConvexMutationOptions, UseConvexMutationReturn } from '@lupinum/better-convex-vue'
import {
  useConvexMutationInternal,
  type OptimisticUpdateCandidate,
  type SynchronousOptimisticUpdate,
} from '@lupinum/better-convex-vue/internal'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { getFunctionName } from 'convex/server'

import { useNuxtApp } from '#imports'

import { readConvexRuntimeContext } from '../runtime-context'
import { createCallableDevtoolsEvents } from '../utils/callable-devtools'

/**
 * Binds a Convex mutation to reactive call state. Nuxt auto-import facade over
 * the shared Vue callable lifecycle; it adds only DevTools observation.
 *
 * ```ts
 * const { mutate, pending, error } = useConvexMutation(api.notes.create)
 * await mutate({ title: 'Hello' })
 * ```
 *
 * `optimisticUpdate` must be synchronous; a Promise-returning updater is a type error.
 */
export function useConvexMutation<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options?: UseConvexMutationOptions<FunctionArgs<Mutation>>,
): UseConvexMutationReturn<Mutation>
/** Binds a Convex mutation with a synchronous `optimisticUpdate` to reactive call state. */
export function useConvexMutation<
  Mutation extends FunctionReference<'mutation'>,
  Update extends OptimisticUpdateCandidate<FunctionArgs<Mutation>>,
>(
  mutation: Mutation,
  options: Readonly<{ optimisticUpdate: Update }> & SynchronousOptimisticUpdate<Update>,
): UseConvexMutationReturn<Mutation>
export function useConvexMutation<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options?: Readonly<{ optimisticUpdate?: OptimisticUpdateCandidate<FunctionArgs<Mutation>> }>,
): UseConvexMutationReturn<Mutation> {
  const runtime = readConvexRuntimeContext(useNuxtApp())
  const observer = createCallableDevtoolsEvents<
    FunctionArgs<Mutation>,
    FunctionReturnType<Mutation>
  >({
    operation: 'mutation',
    fnName: getFunctionName(mutation),
    hasOptimisticUpdate: Boolean(options?.optimisticUpdate),
    getSink: () => runtime?.getDevtoolsSink() ?? null,
  })
  return useConvexMutationInternal(mutation, {
    optimisticUpdate: options?.optimisticUpdate,
    observer,
  })
}
