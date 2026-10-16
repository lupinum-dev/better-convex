import { makeFunctionReference, type PaginationOptions } from 'convex/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef, toValue, type MaybeRefOrGetter } from 'vue'

import { useConvexPaginatedQuery } from '../../src/runtime/composables/useConvexPaginatedQuery'

interface Entry {
  data: { value: unknown }
  status: { value: string }
  promise: Promise<void> | undefined
}

const nuxt = vi.hoisted(() => ({
  app: { payload: { data: {} as Record<string, unknown> }, static: { data: {} } },
  state: new Map<string, { value: unknown }>(),
  entries: new Map<string, Entry>(),
}))
const http = vi.hoisted(() => ({
  calls: [] as { functionPath: string; args: Record<string, unknown> }[],
  answer: (_args: Record<string, unknown>): unknown => null,
}))

// One server render. `useAsyncData` follows Nuxt 4.6 on the server
// (nuxt/dist/app/composables/asyncData.js:89-113, 349-359, 457-460): callers
// of one key share an entry, a caller joins a fetch in flight (`dedupe:
// 'defer'`), and a later caller asks `getCachedData` with cause 'initial',
// whose default reads only prerendered data, before it runs the handler again.
vi.mock('#app', () => ({
  onNuxtReady: () => {},
  useNuxtApp: () => nuxt.app,
  useRequestEvent: () => undefined,
  useState: (key: string, init?: () => unknown) => {
    if (!nuxt.state.has(key)) nuxt.state.set(key, { value: init?.() })
    return nuxt.state.get(key)
  },
  useAsyncData: (
    keySource: MaybeRefOrGetter<string>,
    handler: () => Promise<unknown>,
    options: {
      getCachedData?: (key: string, app: unknown, context: { cause: string }) => unknown
    },
  ) => {
    const key = toValue(keySource)
    let entry = nuxt.entries.get(key)
    if (!entry) {
      entry = { data: shallowRef<unknown>(null), status: shallowRef('idle'), promise: undefined }
      nuxt.entries.set(key, entry)
    }
    const current = entry
    const fetch = () => {
      current.status.value = 'pending'
      current.promise = handler().then((value) => {
        nuxt.app.payload.data[key] = value
        current.data.value = value
        current.status.value = 'success'
        current.promise = undefined
      })
      return current.promise
    }
    const getCachedData =
      options.getCachedData ??
      ((cachedKey: string) => (nuxt.app.static.data as Record<string, unknown>)[cachedKey])
    const cached = current.promise ? undefined : getCachedData(key, nuxt.app, { cause: 'initial' })
    if (cached !== undefined) {
      current.data.value = cached
      current.status.value = 'success'
    }
    const initial = current.promise ?? (cached !== undefined ? Promise.resolve() : fetch())
    return Object.assign(initial, { data: current.data, status: current.status, execute: fetch })
  },
}))
vi.mock('../../src/runtime/utils/runtime-config', () => ({
  getConvexRuntimeConfig: () => ({ url: 'https://demo.convex.cloud', server: {}, auth: false }),
}))
vi.mock('../../src/runtime/utils/query-execution', () => ({
  executeQueryHttp: async (_url: string, functionPath: string, args: Record<string, unknown>) => {
    http.calls.push({ functionPath, args })
    return http.answer(args)
  },
}))

const list = makeFunctionReference<'query'>('changes:list') as never

beforeEach(() => {
  nuxt.state.clear()
  nuxt.entries.clear()
  nuxt.app.payload.data = {}
  http.calls = []
})

function render<T>(factory: () => T): T {
  return effectScope().run(factory)!
}

const paginationOpts = (args: Record<string, unknown>) => args.paginationOpts as PaginationOptions

describe('server render of a first page that Convex marks SplitRequired', () => {
  it('renders the rows of the two bounded halves instead of an error', async () => {
    http.answer = (args) => {
      const { cursor, endCursor } = paginationOpts(args)
      if (endCursor === undefined) {
        return {
          page: [{ _id: 'a' }],
          isDone: false,
          continueCursor: 'c-end',
          splitCursor: 'c-mid',
          pageStatus: 'SplitRequired',
        }
      }
      return cursor === null
        ? { page: [{ _id: 'a' }, { _id: 'b' }], isDone: false, continueCursor: 'c-mid' }
        : { page: [{ _id: 'c' }], isDone: false, continueCursor: 'c-end' }
    }

    const listState = await render(() =>
      useConvexPaginatedQuery(list, {}, { auth: 'none', initialNumItems: 50 }),
    )

    expect(listState.status.value).toBe('success')
    expect(listState.error.value).toBeUndefined()
    expect(listState.data.value).toEqual([{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }])
    expect(listState.canLoadMore.value).toBe(true)
    expect(http.calls.map((call) => paginationOpts(call.args))).toEqual([
      { numItems: 50, cursor: null },
      { numItems: 50, cursor: null, endCursor: 'c-mid' },
      { numItems: 50, cursor: 'c-mid', endCursor: 'c-end' },
    ])
  })

  it('leaves the list to the browser when a half still needs a split', async () => {
    http.answer = (args) => ({
      page: [{ _id: 'a' }],
      isDone: false,
      continueCursor: paginationOpts(args).endCursor ?? 'c-end',
      splitCursor: 'c-mid',
      pageStatus: 'SplitRequired',
    })

    const listState = await render(() =>
      useConvexPaginatedQuery(list, {}, { auth: 'none', initialNumItems: 50 }),
    )

    expect(listState.status.value).toBe('idle')
    expect(listState.error.value).toBeUndefined()
    expect(listState.data.value).toBeUndefined()
    expect(http.calls).toHaveLength(3)
  })
})
