import type {
  ConvexQueriesEntry,
  ConvexQueriesSource,
  ConvexQueriesStates,
  UseConvexQueriesState,
} from '@lupinum/better-convex-vue'
import {
  effectScope,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type ShallowRef,
} from 'vue'

import { useNuxtApp } from '#imports'

import { createNuxtAwaitableState } from './nuxt-awaitable-state'
import { resolveQueryLifecycleOptions } from './query-lifecycle-options'
import {
  useConvexQuery,
  type NuxtConvexQuery,
  type UseNuxtConvexQueryOptions,
} from './useConvexQuery'

export type { ConvexQueriesEntry, ConvexQueriesSource, ConvexQueriesStates }

interface UseNuxtConvexQueriesBaseOptions {
  readonly server?: boolean
}

export type UseNuxtConvexQueriesOptions = UseNuxtConvexQueriesBaseOptions &
  (
    | { readonly immediate?: true; readonly lazy?: boolean }
    | { readonly immediate: false; readonly lazy?: false }
  )

export type NuxtConvexQueries<Source extends ConvexQueriesSource> = UseConvexQueriesState<Source> &
  Promise<UseConvexQueriesState<Source>>

interface OwnedQuery {
  readonly query: ConvexQueriesEntry['query']
  readonly auth: ConvexQueriesEntry['auth']
  readonly keepPreviousData: boolean
  readonly scope: ReturnType<typeof effectScope>
  readonly state: NuxtConvexQuery<unknown>
}

export function useConvexQueries<Source extends ConvexQueriesSource>(
  source: MaybeRefOrGetter<Source>,
  options: UseNuxtConvexQueriesOptions = {},
): NuxtConvexQueries<Source> {
  const lifecycle = resolveQueryLifecycleOptions(options)

  const owned = new Map<string, OwnedQuery>()
  const nuxtApp = useNuxtApp()
  const states = shallowRef({}) as ShallowRef<ConvexQueriesStates<Source>>
  const initialSettlements: Promise<unknown>[] = []
  let takingInitialSnapshot = true

  const publish = () => {
    states.value = Object.freeze(
      Object.fromEntries([...owned].map(([key, controller]) => [key, controller.state])),
    ) as unknown as ConvexQueriesStates<Source>
  }
  const dispose = (key: string) => {
    owned.get(key)?.scope.stop()
    owned.delete(key)
  }
  const synchronize = () => {
    const entries = toValue(source)
    for (const key of owned.keys()) if (!Object.hasOwn(entries, key)) dispose(key)
    for (const [key, entry] of Object.entries(entries)) {
      const keepPreviousData = entry.keepPreviousData ?? false
      const previous = owned.get(key)
      if (
        previous &&
        previous.query === entry.query &&
        previous.auth === entry.auth &&
        previous.keepPreviousData === keepPreviousData
      ) {
        continue
      }
      if (previous) dispose(key)
      const scope = effectScope(true)
      const lifecycleOptions: UseNuxtConvexQueryOptions =
        lifecycle.immediate === false
          ? { immediate: false, lazy: false, server: options.server }
          : { immediate: true, lazy: lifecycle.lazy, server: options.server }
      const state = scope.run(() =>
        nuxtApp.vueApp.runWithContext(() =>
          nuxtApp.runWithContext(() =>
            useConvexQuery(entry.query, () => toValue(toValue(source)[key]?.args ?? {}), {
              auth: entry.auth,
              keepPreviousData,
              ...lifecycleOptions,
            }),
          ),
        ),
      ) as NuxtConvexQuery<unknown> | undefined
      if (!state) {
        scope.stop()
        throw new Error(`[better-convex-nuxt] could not create query controller for key "${key}"`)
      }
      owned.set(key, {
        query: entry.query,
        auth: entry.auth,
        keepPreviousData,
        scope,
        state,
      })
      if (takingInitialSnapshot) initialSettlements.push(state)
    }
    publish()
  }

  const stop = watch(() => toValue(source), synchronize, {
    deep: true,
    immediate: true,
    flush: 'sync',
  })
  takingInitialSnapshot = false
  onScopeDispose(() => {
    stop()
    for (const key of [...owned.keys()]) dispose(key)
  })

  async function run(method: 'execute' | 'refresh', key?: string): Promise<void> {
    if (key !== undefined) {
      await owned.get(key)?.state[method]()
      return
    }
    await Promise.all([...owned.values()].map(({ state }) => state[method]()))
  }

  const result = Object.freeze({
    states,
    execute: (key?: keyof Source & string) => run('execute', key),
    refresh: (key?: keyof Source & string) => run('refresh', key),
  }) as UseConvexQueriesState<Source>
  return createNuxtAwaitableState(result, Promise.all(initialSettlements))
}
