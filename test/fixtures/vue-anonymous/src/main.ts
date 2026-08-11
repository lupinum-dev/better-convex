import {
  createBetterConvex,
  useConvexAction,
  useConvexConnectionState,
  useConvexMutation,
  useConvexPaginatedQuery,
  useConvexQuery,
} from 'better-convex-vue'
import {
  makeFunctionReference,
  type FunctionReference,
  type PaginationOptions,
  type PaginationResult,
} from 'convex/server'
import { createApp, defineComponent, h, ref } from 'vue'

const query = makeFunctionReference<'query'>('notes:list') as FunctionReference<
  'query',
  'public',
  { owner: string },
  string[]
>
const paginatedQuery = makeFunctionReference<'query'>('notes:listPaginated') as FunctionReference<
  'query',
  'public',
  { owner: string; paginationOpts: PaginationOptions },
  PaginationResult<string>
>
const mutation = makeFunctionReference<'mutation'>('notes:rename')
const action = makeFunctionReference<'action'>('notes:report')

function packedTypeContracts() {
  const paginationOptions = { initialNumItems: 10 } as const
  void useConvexQuery(query, { owner: 'alice' })
  void useConvexQuery(query, ref<{ owner: string } | 'skip'>('skip'))
  void useConvexQuery(query, () => 'skip' as const)
  // @ts-expect-error null is not a query skip sentinel
  void useConvexQuery(query, null)
  // @ts-expect-error undefined is not a query skip sentinel
  void useConvexQuery(query, undefined)
  // @ts-expect-error a ref containing null is not a query skip sentinel
  void useConvexQuery(query, ref(null))
  // @ts-expect-error a ref containing undefined is not a query skip sentinel
  void useConvexQuery(query, ref(undefined))
  // @ts-expect-error a getter returning null is not a query skip sentinel
  void useConvexQuery(query, () => null)
  // @ts-expect-error a getter returning undefined is not a query skip sentinel
  void useConvexQuery(query, () => undefined)

  void useConvexPaginatedQuery(paginatedQuery, { owner: 'alice' }, paginationOptions)
  void useConvexPaginatedQuery(
    paginatedQuery,
    ref<{ owner: string } | 'skip'>('skip'),
    paginationOptions,
  )
  void useConvexPaginatedQuery(paginatedQuery, () => 'skip' as const, paginationOptions)
  // @ts-expect-error null is not a paginated query skip sentinel
  void useConvexPaginatedQuery(paginatedQuery, null, paginationOptions)
  // @ts-expect-error undefined is not a paginated query skip sentinel
  void useConvexPaginatedQuery(paginatedQuery, undefined, paginationOptions)
  // @ts-expect-error a ref containing null is not a paginated query skip sentinel
  void useConvexPaginatedQuery(paginatedQuery, ref(null), paginationOptions)
  // @ts-expect-error a ref containing undefined is not a paginated query skip sentinel
  void useConvexPaginatedQuery(paginatedQuery, ref(undefined), paginationOptions)
  // @ts-expect-error a getter returning null is not a paginated query skip sentinel
  void useConvexPaginatedQuery(paginatedQuery, () => null, paginationOptions)
  // @ts-expect-error a getter returning undefined is not a paginated query skip sentinel
  void useConvexPaginatedQuery(paginatedQuery, () => undefined, paginationOptions)
}

void packedTypeContracts

const AnonymousConsumer = defineComponent({
  setup() {
    const notes = useConvexQuery(query, 'skip')
    const pages = useConvexPaginatedQuery(paginatedQuery, 'skip', { initialNumItems: 10 })
    const rename = useConvexMutation(mutation)
    const report = useConvexAction(action)
    const connection = useConvexConnectionState()

    return () =>
      h('main', { 'data-consumer': 'better-convex-vue-anonymous' }, [
        h('p', `query:${notes.status.value}`),
        h('p', `pagination:${pages.status.value}`),
        h('p', `mutation:${rename.status.value}`),
        h('p', `action:${report.status.value}`),
        h('p', `connected:${connection.isConnected.value}`),
      ])
  },
})

createApp(AnonymousConsumer)
  .use(createBetterConvex({ convexUrl: 'https://anonymous-consumer.invalid' }))
  .mount('#app')
