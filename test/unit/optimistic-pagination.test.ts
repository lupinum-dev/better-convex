// @vitest-environment happy-dom
import type { OptimisticLocalStore } from 'convex/browser'
import {
  getFunctionName,
  makeFunctionReference,
  type PaginationOptions,
  type PaginationResult,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type OptionalRestArgs,
} from 'convex/server'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, type App } from 'vue'

import { useConvexPaginatedQuery } from '../../packages/vue/src'
import {
  insertAtTop,
  optimisticallyUpdateValueInPaginatedQuery,
} from '../../packages/vue/src/experimental'
import { setupBetterConvexTest, type BetterConvexTestRuntime } from '../../packages/vue/src/test'

const pageNotes = makeFunctionReference<
  'query',
  { folder: string; filter: { tags: string[] }; paginationOpts: PaginationOptions },
  PaginationResult<{ id: string; title: string }>
>('notes:page')

type Page = FunctionReturnType<typeof pageNotes>
type Args = FunctionArgs<typeof pageNotes>
const item = { id: 'new', title: 'New note' }
const first: Page = {
  page: [{ id: 'target', title: 'Before' }],
  continueCursor: 'next',
  isDone: false,
}
const second: Page = {
  page: [
    { id: 'target', title: 'Before' },
    { id: 'other', title: 'Other' },
  ],
  continueCursor: '',
  isDone: true,
}
const apps: App[] = []
const runtimes: BetterConvexTestRuntime[] = []

afterEach(async () => {
  for (const app of apps.splice(0)) app.unmount()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  document.body.innerHTML = ''
})

async function loadList(folder = 'inbox', options?: { pending?: boolean; cursor?: string }) {
  const runtime = setupBetterConvexTest()
  runtimes.push(runtime)
  const list = runtime.paginatedQuery(pageNotes, { folder, filter: { tags: ['active'] } })
  if (!options?.pending) list.page(options?.cursor).resolve(first)
  let state!: ReturnType<typeof useConvexPaginatedQuery<typeof pageNotes>>
  const app = createApp({
    setup() {
      state = useConvexPaginatedQuery(
        pageNotes,
        { folder, filter: { tags: ['active'] } },
        {
          initialNumItems: 2,
          initialCursor: options?.cursor,
        },
      )
      return () => h('div')
    },
  }).use(runtime.plugin)
  apps.push(app)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  await runtime.flush()
  if (!options?.pending) {
    list.page('next').resolve(second)
    await state.loadMore(2)
    await runtime.flush()
  }
  // Use the actual controller subscriptions, including its bounded first-page resubscription.
  const entries = list.calls.map(({ args }) => ({
    args,
    value: options?.pending ? undefined : args.paginationOpts.cursor === 'next' ? second : first,
  }))
  return entries
}

function localStore(entries: Array<{ args: Args; value: Page | undefined }>): OptimisticLocalStore {
  const key = (args: unknown) => JSON.stringify(args)
  const values = new Map(entries.map((entry) => [key(entry.args), entry]))
  return {
    getQuery<Query extends FunctionReference<'query'>>(
      query: Query,
      ...args: OptionalRestArgs<Query>
    ) {
      return (
        getFunctionName(query) === getFunctionName(pageNotes)
          ? values.get(key(args[0]))?.value
          : undefined
      ) as FunctionReturnType<Query> | undefined
    },
    getAllQueries<Query extends FunctionReference<'query'>>(query: Query) {
      // The store holds only this test's typed page query; the interface is generic.
      return (
        getFunctionName(query) === getFunctionName(pageNotes) ? [...values.values()] : []
      ) as {
        args: FunctionArgs<Query>
        value: FunctionReturnType<Query> | undefined
      }[]
    },
    setQuery(_query, args, value) {
      values.set(key(args), {
        args: args as Args,
        value: value as Page | undefined,
      })
    },
  }
}

describe('experimental optimistic pagination', () => {
  it('inserts at the start without duplicating the item on later pages or mutating cached results', async () => {
    const store = localStore(await loadList())
    const before = store.getAllQueries(pageNotes)
    expect(before[0]!.args.paginationOpts.cursor).toBeNull()
    insertAtTop({ paginatedQuery: pageNotes, localQueryStore: store, item })
    expect(store.getAllQueries(pageNotes).map(({ value }) => value?.page)).toEqual([
      [item, { id: 'target', title: 'Before' }],
      [{ id: 'target', title: 'Before' }],
      [
        { id: 'target', title: 'Before' },
        { id: 'other', title: 'Other' },
      ],
    ])
    expect(before[0]!.value).toEqual(first)
    expect(store.getAllQueries(pageNotes)[0]!.value).toMatchObject({
      continueCursor: 'next',
      isDone: false,
    })
  })

  it('does not insert into another list when argsToMatch selects one list', async () => {
    const store = localStore([...(await loadList('inbox')), ...(await loadList('archive'))])
    const before = store.getAllQueries(pageNotes)
    insertAtTop({
      paginatedQuery: pageNotes,
      argsToMatch: { filter: { tags: ['hidden'] } },
      localQueryStore: store,
      item,
    })
    expect(store.getAllQueries(pageNotes)).toEqual(before)
    insertAtTop({
      paginatedQuery: pageNotes,
      argsToMatch: { folder: 'archive', filter: { tags: ['active'] } },
      localQueryStore: store,
      item,
    })
    const pages = store.getAllQueries(pageNotes)
    expect(
      pages.filter(({ args }) => args.folder === 'inbox').map(({ value }) => value?.page[0]?.id),
    ).toEqual(['target', 'target', 'target'])
    expect(
      pages.filter(({ args }) => args.folder === 'archive').map(({ value }) => value?.page[0]?.id),
    ).toEqual(['new', 'target', 'target'])
  })

  it.each([{ pending: true }, { cursor: 'resumed' }])(
    'does not invent a first page when it is unloaded or the list resumes at a cursor (%j)',
    async (options) => {
      const store = localStore(await loadList('inbox', options))
      const before = store.getAllQueries(pageNotes)
      insertAtTop({ paginatedQuery: pageNotes, localQueryStore: store, item })
      expect(store.getAllQueries(pageNotes)).toEqual(before)
    },
  )

  it('updates the matching item on every loaded page without changing other lists, items, or page metadata', async () => {
    const store = localStore([
      ...(await loadList()),
      ...(await loadList('archive')),
      ...(await loadList('pending', { pending: true })),
    ])
    const before = store.getAllQueries(pageNotes)
    optimisticallyUpdateValueInPaginatedQuery({
      paginatedQuery: pageNotes,
      argsToMatch: { folder: 'inbox' },
      localQueryStore: store,
      updateValue: (value) => (value.id === 'target' ? { ...value, title: 'After' } : value),
    })
    const pages = store.getAllQueries(pageNotes)
    expect(
      pages.filter(({ args }) => args.folder === 'inbox').map(({ value }) => value?.page),
    ).toEqual([
      [{ id: 'target', title: 'After' }],
      [{ id: 'target', title: 'After' }],
      [
        { id: 'target', title: 'After' },
        { id: 'other', title: 'Other' },
      ],
    ])
    expect(pages.filter(({ args }) => args.folder !== 'inbox')).toEqual(
      before.filter(({ args }) => args.folder !== 'inbox'),
    )
    expect(pages.map(({ value }) => value && { ...value, page: [] })).toEqual(
      before.map(({ value }) => value && { ...value, page: [] }),
    )
    expect(before[0]!.value).toEqual(first)
  })

  it('updates all loaded list variants when argsToMatch is omitted and leaves pending pages alone', async () => {
    const store = localStore([
      ...(await loadList()),
      ...(await loadList('archive')),
      ...(await loadList('pending', { pending: true })),
    ])
    optimisticallyUpdateValueInPaginatedQuery({
      paginatedQuery: pageNotes,
      localQueryStore: store,
      updateValue: (value) => ({ ...value, title: 'Changed' }),
    })
    const pages = store.getAllQueries(pageNotes)
    expect(
      pages
        .filter(({ args }) => args.folder !== 'pending')
        .map(({ value }) => value?.page.map((row) => row.title)),
    ).toEqual([
      ['Changed'],
      ['Changed'],
      ['Changed', 'Changed'],
      ['Changed'],
      ['Changed'],
      ['Changed', 'Changed'],
    ])
    expect(pages.filter(({ args }) => args.folder === 'pending').map(({ value }) => value)).toEqual(
      [undefined],
    )
  })
})
