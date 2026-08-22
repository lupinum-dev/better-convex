import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import {
  effectScope,
  getCurrentScope,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type ShallowRef,
} from 'vue'

import { useBetterConvexRuntime } from './runtime-context'
import { useConvexQuery, type ConvexAuthMode, type UseConvexQueryState } from './use-query'

type AnyQuery = FunctionReference<'query'>

export interface ConvexQueriesEntry<Query extends AnyQuery = AnyQuery> {
  readonly query: Query
  readonly args?: MaybeRefOrGetter<FunctionArgs<Query> | 'skip'>
  readonly auth?: ConvexAuthMode
  readonly keepPreviousData?: boolean
}

export type ConvexQueriesSource = Readonly<Record<string, ConvexQueriesEntry>>

type EntryState<Entry> =
  Entry extends ConvexQueriesEntry<infer Query>
    ? UseConvexQueryState<FunctionReturnType<Query>>
    : never

export type ConvexQueriesStates<Source extends ConvexQueriesSource> = {
  readonly [Key in keyof Source]: EntryState<Source[Key]>
}

export interface UseConvexQueriesState<Source extends ConvexQueriesSource> {
  readonly states: Readonly<ShallowRef<ConvexQueriesStates<Source>>>
  execute(key?: keyof Source & string): Promise<void>
  refresh(key?: keyof Source & string): Promise<void>
}

interface OwnedQuery {
  readonly query: AnyQuery
  readonly auth: ConvexAuthMode
  readonly keepPreviousData: boolean
  readonly scope: ReturnType<typeof effectScope>
  readonly state: UseConvexQueryState<unknown>
}

export function useConvexQueries<Source extends ConvexQueriesSource>(
  source: MaybeRefOrGetter<Source>,
  options: { readonly immediate?: boolean } = {},
): UseConvexQueriesState<Source> {
  if (!getCurrentScope()) {
    throw new Error('[better-convex-vue] useConvexQueries must run inside a Vue effect scope')
  }

  const owned = new Map<string, OwnedQuery>()
  const runtime = useBetterConvexRuntime()
  const states = shallowRef({}) as ShallowRef<ConvexQueriesStates<Source>>

  const publish = () => {
    states.value = Object.freeze(
      Object.fromEntries([...owned].map(([key, controller]) => [key, controller.state])),
    ) as ConvexQueriesStates<Source>
  }

  const dispose = (key: string) => {
    owned.get(key)?.scope.stop()
    owned.delete(key)
  }

  const synchronize = () => {
    const entries = toValue(source)
    for (const key of owned.keys()) {
      if (!Object.hasOwn(entries, key)) dispose(key)
    }
    for (const [key, entry] of Object.entries(entries)) {
      const auth = entry.auth ?? 'optional'
      const keepPreviousData = entry.keepPreviousData ?? false
      const current = owned.get(key)
      if (
        current &&
        current.query === entry.query &&
        current.auth === auth &&
        current.keepPreviousData === keepPreviousData
      ) {
        continue
      }
      if (current) dispose(key)
      const scope = effectScope(true)
      const state = scope.run(
        () =>
          Reflect.apply(useConvexQuery, undefined, [
            entry.query,
            () => toValue(toValue(source)[key]?.args ?? {}),
            { auth, keepPreviousData, immediate: options.immediate },
            undefined,
            runtime,
          ]) as UseConvexQueryState<unknown>,
      )
      if (!state) {
        scope.stop()
        throw new Error(`[better-convex-vue] could not create query controller for key "${key}"`)
      }
      owned.set(key, { query: entry.query, auth, keepPreviousData, scope, state })
    }
    publish()
  }

  const stop = watch(() => toValue(source), synchronize, {
    deep: true,
    immediate: true,
    flush: 'sync',
  })
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

  return Object.freeze({
    states,
    execute: (key?: keyof Source & string) => run('execute', key),
    refresh: (key?: keyof Source & string) => run('refresh', key),
  })
}
