import {
  useConvexMutation as useVueConvexMutation,
  type UseConvexCall,
  type UseConvexMutationOptions as VueMutationOptions,
} from '@lupinum/better-convex-vue'
import type { OptimisticLocalStore } from 'convex/browser'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { getFunctionName } from 'convex/server'

import { useNuxtApp } from '#imports'

import { readConvexRuntimeContext } from '../runtime-context'
import { createCallableDevtoolsEvents } from '../utils/callable-devtools'
import { CALLABLE_OBSERVER_KEY } from '../utils/callable-observer'

export type UseConvexMutationOptions<Args extends Record<string, unknown>> =
  VueMutationOptions<Args>

type OptimisticUpdateCandidate<Args> = (store: OptimisticLocalStore, args: Args) => unknown
type ReturnHasThen<Result> = Result extends unknown
  ? 'then' extends keyof Result
    ? true
    : false
  : never
type SynchronousOptimisticUpdate<Update extends (...args: never[]) => unknown> =
  true extends ReturnHasThen<ReturnType<Update>>
    ? 'Optimistic update handlers must be synchronous'
    : unknown

/** Nuxt auto-import facade over the one shared Vue callable lifecycle. */
export function useConvexMutation<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options?: UseConvexMutationOptions<FunctionArgs<Mutation>>,
): UseConvexCall<Mutation>
export function useConvexMutation<
  Mutation extends FunctionReference<'mutation'>,
  Update extends OptimisticUpdateCandidate<FunctionArgs<Mutation>>,
>(
  mutation: Mutation,
  options: Readonly<{ optimisticUpdate: Update }> & SynchronousOptimisticUpdate<Update>,
): UseConvexCall<Mutation>
export function useConvexMutation<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options?: Readonly<{ optimisticUpdate?: OptimisticUpdateCandidate<FunctionArgs<Mutation>> }>,
): UseConvexCall<Mutation> {
  const runtime = readConvexRuntimeContext(useNuxtApp())
  const events = createCallableDevtoolsEvents<FunctionArgs<Mutation>, FunctionReturnType<Mutation>>(
    {
      operation: 'mutation',
      fnName: getFunctionName(mutation),
      hasOptimisticUpdate: Boolean(options?.optimisticUpdate),
      getSink: () => runtime?.getDevtoolsSink() ?? null,
    },
  )
  const internalOptions = {
    ...options,
    [CALLABLE_OBSERVER_KEY]: events,
  }
  return (
    useVueConvexMutation as unknown as (
      reference: Mutation,
      internalOptions: Record<PropertyKey, unknown>,
    ) => UseConvexCall<Mutation>
  )(mutation, internalOptions)
}
