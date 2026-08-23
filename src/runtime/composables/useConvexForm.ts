import { useConvexForm as useVueConvexForm } from '@lupinum/better-convex-vue'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { getFunctionName } from 'convex/server'

import { useNuxtApp } from '#imports'

import { readConvexRuntimeContext } from '../runtime-context'
import { createCallableDevtoolsEvents } from '../utils/callable-devtools'
import { CALLABLE_OBSERVER_KEY } from '../utils/callable-observer'

type FormOptions = Readonly<{
  schema: unknown
  toArgs?: (values: unknown) => Record<string, unknown>
  mapError?: (error: unknown) => unknown
}>

/** Nuxt auto-import facade over the shared Vue form and mutation lifecycles. */
export const useConvexForm: typeof useVueConvexForm = ((
  mutation: FunctionReference<'mutation'>,
  options: FormOptions,
) => {
  const runtime = readConvexRuntimeContext(useNuxtApp())
  const events = createCallableDevtoolsEvents<
    FunctionArgs<typeof mutation>,
    FunctionReturnType<typeof mutation>
  >({
    operation: 'mutation',
    fnName: getFunctionName(mutation),
    hasOptimisticUpdate: false,
    getSink: () => runtime?.getDevtoolsSink() ?? null,
  })
  const internalOptions = { ...options, [CALLABLE_OBSERVER_KEY]: events }
  return (
    useVueConvexForm as unknown as (
      reference: FunctionReference<'mutation'>,
      options: Record<PropertyKey, unknown>,
    ) => unknown
  )(mutation, internalOptions)
}) as typeof useVueConvexForm
