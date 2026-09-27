import type { useConvexForm as useVueConvexForm } from '@lupinum/better-convex-vue'
import {
  useConvexFormInternal,
  type ConvexFormInternalOptions,
} from '@lupinum/better-convex-vue/internal'
import type { FunctionReference } from 'convex/server'
import { getFunctionName } from 'convex/server'

import { useNuxtApp } from '#imports'

import { readConvexRuntimeContext } from '../runtime-context'
import { createCallableDevtoolsEvents } from '../utils/callable-devtools'

/** Nuxt auto-import facade over the shared Vue form and mutation lifecycles. */
export const useConvexForm = ((
  mutation: FunctionReference<'mutation'>,
  options: ConvexFormInternalOptions,
) => {
  const runtime = readConvexRuntimeContext(useNuxtApp())
  const observer = createCallableDevtoolsEvents<Record<string, unknown>, unknown>({
    operation: 'mutation',
    fnName: getFunctionName(mutation),
    hasOptimisticUpdate: false,
    getSink: () => runtime?.getDevtoolsSink() ?? null,
  })
  return useConvexFormInternal(mutation, options, observer)
}) as typeof useVueConvexForm
