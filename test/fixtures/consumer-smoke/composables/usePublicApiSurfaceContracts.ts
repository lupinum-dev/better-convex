import { defineConvexAuthClient } from 'better-convex-nuxt/auth-client'
import type { ConvexAuthClientDefinition } from 'better-convex-nuxt/auth-client'
import type { OptimisticLocalStore } from 'convex/browser'
import type { ComputedRef, Ref } from 'vue'
import { ref } from 'vue'

import { api } from '#convex/api'

function assertType<T>(_value: T): void {}

export async function usePublicApiSurfaceContracts(file: File) {
  const auth = useConvexAuth()
  assertType<Ref<boolean>>(auth.isAuthenticated)
  assertType<'disabled' | 'loading' | 'anonymous' | 'authenticated' | 'error'>(auth.status.value)

  const config = useConvexConfig()
  assertType<string | undefined>(config.url)
  // @ts-expect-error `useConvexConfig()` returns a read-only projection
  //  — every field is `readonly`, so assignment must not compile.
  config.url = 'https://mutated.convex.cloud'
  if (config.auth !== false) {
    assertType<string>(config.auth.publicOrigin)
    assertType<string>(config.auth.proxy.trustedClientIpHeader)
    // @ts-expect-error `auth.client` is build-only and never reaches runtime config.
    void config.auth.client
    // @ts-expect-error nested auth fields are also read-only.
    config.auth.proxy.trustedClientIpHeader = 'mutated'
    // @ts-expect-error the canonical public origin is read-only.
    config.auth.publicOrigin = 'https://mutated.example.test'
  }

  // Canonical/profile user helper: positional args are required, even for a
  // no-argument query . Not an alias for `useConvexAuth().user`.
  const user = useConvexUser(api.auth.viewer, {})
  assertType<'none' | 'session' | 'better-auth' | 'projection'>(user.source.value)

  // The stable client handle exposes exactly query, mutation, action, and onUpdate.
  const convex = useConvex()
  assertType<string[]>(await convex.query(api.tasks.list, {}))
  assertType<string>(await convex.mutation(api.tasks.create, { text: 'from smoke' }))
  assertType<{ ok: boolean }>(
    await convex.action(api.emails.send, { to: 'team@example.com', subject: 'Smoke' }),
  )
  assertType<() => void>(
    convex.onUpdate(
      api.tasks.list,
      {},
      () => {},
      () => {},
    ),
  )

  const list = await useConvexQuery(api.tasks.list, {}, { initialData: [] })
  assertType<ComputedRef<boolean>>(list.isStale)
  assertType<string[]>(list.data.value ?? [])

  const skipped = await useConvexQuery(api.tasks.list, 'skip')
  assertType<'idle' | 'pending' | 'success' | 'error'>(skipped.status.value)

  const sharedList = defineSharedConvexQuery({
    query: api.tasks.list,
    args: {},
    options: { initialData: [] },
  })
  assertType<string[]>(sharedList().data.value ?? [])

  const paginated = await useConvexPaginatedQuery(
    api.tasks.listPaginated,
    {},
    { initialNumItems: 5 },
  )
  assertType<string[]>(paginated.results.value)
  assertType<boolean>(paginated.isStale.value)

  const createTask = useConvexMutation(api.tasks.create, {
    optimisticUpdate(store, args) {
      assertType<OptimisticLocalStore>(store)
      assertType<string>(args.text)
      updateQuery({
        query: api.tasks.list,
        args: {},
        store,
        updater: (current) => [...(current ?? []), args.text],
      })
      setQueryData({ query: api.tasks.list, args: {}, store, value: [args.text] })
      updateAllQueries({
        query: api.tasks.list,
        store,
        updater: (current) => current ?? [],
      })
      deleteFromQuery({
        query: api.tasks.list,
        args: {},
        store,
        shouldDelete: (item) => item === args.text,
      })
      insertAtTop({ query: api.tasks.listPaginated, store, item: args.text })
      insertAtPosition({
        query: api.tasks.listPaginated,
        store,
        item: args.text,
        sortOrder: 'asc',
        sortKeyFromItem: (item) => item,
      })
      insertAtBottomIfLoaded({ query: api.tasks.listPaginated, store, item: args.text })
      updateInPaginatedQuery({
        query: api.tasks.listPaginated,
        store,
        updateValue: (item) => (item === args.text ? item.toUpperCase() : item),
      })
      deleteFromPaginatedQuery({
        query: api.tasks.listPaginated,
        store,
        shouldDelete: (item) => item === args.text,
      })
    },
  })
  assertType<string>(await createTask({ text: 'callable' }))
  assertType<boolean>((await createTask.safe({ text: 'safe' })).ok)

  const sendEmail = useConvexAction(api.emails.send)
  assertType<{ ok: boolean }>(await sendEmail({ to: 'team@example.com', subject: 'Smoke' }))
  assertType<boolean>((await sendEmail.safe({ to: 'team@example.com', subject: 'Smoke' })).ok)

  const upload = useConvexFileUpload(api.files.generateUploadUrl)
  assertType<string>(await upload.upload(file))
  assertType<ComputedRef<string | null>>(useConvexStorageUrl(api.files.getUrl, upload.data))
  // Auth transport mode is the three-literal ConvexAuthMode.
  assertType<ComputedRef<string | null>>(
    useConvexStorageUrl(api.files.getUrl, upload.data, { auth: 'required' }),
  )

  const queue = useConvexUploadQueue(api.files.generateUploadUrl)
  assertType<string[]>(await queue.enqueue(file))
  assertType<boolean>((await queue.enqueueSafe(file)).ok)

  // The framework-free typed client definition comes from the auth-client entry. The
  // plugin-typed narrowing of `useConvexAuth().client` is proven end-to-end in
  // the single-`better-auth`-copy packed fixture `test/fixtures/auth-client-typing`;
  // this linked smoke only pins the value + empty-definition type surface.
  const emptyDefinition = defineConvexAuthClient()
  assertType<ConvexAuthClientDefinition<[]>>(emptyDefinition)
}

/**
 * Public call-arity contracts. These calls pin the required args position and
 * accepted query argument shapes against the packed package.
 */
async function _requiredArgsContracts() {
  // --- useConvexQuery: args are ALWAYS positional and required, even for a
  // no-argument Convex function (decision 9) ---
  // Positive: no-arg queries require an explicit `{}`.
  void useConvexQuery(api.tasks.list, {})
  // Positive: the skip sentinel is the only other legal args-slot value.
  void useConvexQuery(api.tasks.list, 'skip')
  // @ts-expect-error args are always positional; the slot cannot be omitted
  void useConvexQuery(api.tasks.list)
  // @ts-expect-error null is not the skip sentinel
  void useConvexQuery(api.tasks.list, null)
  // @ts-expect-error undefined is not the skip sentinel
  void useConvexQuery(api.tasks.list, undefined)
  // @ts-expect-error a ref containing null is not the skip sentinel
  void useConvexQuery(api.tasks.list, ref(null))
  // @ts-expect-error a ref containing undefined is not the skip sentinel
  void useConvexQuery(api.tasks.list, ref(undefined))
  // @ts-expect-error a getter returning null is not the skip sentinel
  void useConvexQuery(api.tasks.list, () => null)
  // @ts-expect-error a getter returning undefined is not the skip sentinel
  void useConvexQuery(api.tasks.list, () => undefined)
  // Positive: correct required args compile.
  void useConvexQuery(api.files.getUrl, { storageId: 'file_1' })
  // @ts-expect-error required args must not be omittable
  void useConvexQuery(api.files.getUrl)
  // @ts-expect-error wrong arg shape must not compile
  void useConvexQuery(api.files.getUrl, { wrong: 1 })
  // @ts-expect-error no-arg functions must reject arbitrary properties (R2-3.3b)
  void useConvexQuery(api.tasks.list, { initialNumItems: 5 })
  // @ts-expect-error options can never occupy the args slot
  void useConvexQuery(api.tasks.list, { server: false })

  // --- useConvexQuery: all-optional args still require the explicit slot
  // (decision 9 — this differs from earlier behavior, where all-optional
  // args could omit the slot entirely) ---
  // Positive: all-optional args accept a populated object.
  void useConvexQuery(api.tasks.search, { limit: 5 })
  // Positive: all-optional args accept a partial object.
  void useConvexQuery(api.tasks.search, { term: 'x' })
  // Positive: all-optional args accept an empty object.
  void useConvexQuery(api.tasks.search, {})
  // Positive: all-optional args accept the skip sentinel.
  void useConvexQuery(api.tasks.search, 'skip')
  // @ts-expect-error all-optional args no longer omit the args slot (decision 9)
  void useConvexQuery(api.tasks.search)
  // @ts-expect-error all-optional args still reject unknown properties (R2-3.3b)
  void useConvexQuery(api.tasks.search, { limit: 5, wrong: 1 })

  // --- useConvexQuery: union all-optional args stay callable (R2-3.3c) ---
  // Top-level v.union(...) validators produce union args; each member must be
  // judged by its own keys, not the union's key intersection.
  void useConvexQuery(api.tasks.filter, { term: 'x' })
  void useConvexQuery(api.tasks.filter, { limit: 5 })
  void useConvexQuery(api.tasks.filter, 'skip')
  // @ts-expect-error union all-optional args no longer omit the args slot
  void useConvexQuery(api.tasks.filter)
  // @ts-expect-error union all-optional args still reject unknown properties (R2-3.3c)
  void useConvexQuery(api.tasks.filter, { wrong: 1 })

  // --- useConvexPaginatedQuery ---
  // Positive: no extra-args paginated query still requires the explicit `{}`.
  void useConvexPaginatedQuery(api.tasks.listPaginated, {})
  void useConvexPaginatedQuery(api.tasks.listPaginated, 'skip')
  // @ts-expect-error paginated queries never omit the args slot either
  void useConvexPaginatedQuery(api.tasks.listPaginated)
  // @ts-expect-error null is not the paginated skip sentinel
  void useConvexPaginatedQuery(api.tasks.listPaginated, null)
  // @ts-expect-error undefined is not the paginated skip sentinel
  void useConvexPaginatedQuery(api.tasks.listPaginated, undefined)
  // @ts-expect-error a ref containing null is not the paginated skip sentinel
  void useConvexPaginatedQuery(api.tasks.listPaginated, ref(null))
  // @ts-expect-error a ref containing undefined is not the paginated skip sentinel
  void useConvexPaginatedQuery(api.tasks.listPaginated, ref(undefined))
  // @ts-expect-error a getter returning null is not the paginated skip sentinel
  void useConvexPaginatedQuery(api.tasks.listPaginated, () => null)
  // @ts-expect-error a getter returning undefined is not the paginated skip sentinel
  void useConvexPaginatedQuery(api.tasks.listPaginated, () => undefined)
  // @ts-expect-error options object must not be accepted in the args slot (follow-up)
  void useConvexPaginatedQuery(api.tasks.listPaginated, { initialNumItems: 5 })
  // Positive: correct required extra args compile.
  void useConvexPaginatedQuery(api.tasks.listPaginatedByOwner, { owner: 'user_1' })
  // @ts-expect-error required paginated args must not be omittable
  void useConvexPaginatedQuery(api.tasks.listPaginatedByOwner)
  // @ts-expect-error wrong paginated arg shape must not compile
  void useConvexPaginatedQuery(api.tasks.listPaginatedByOwner, { wrong: 1 })

  // --- useConvexUser: canonical/profile query helper follows the same
  // positional explicit-args grammar; it is not an alias for
  // `useConvexAuth().user` ---
  // Positive: no-arg canonical user query still requires the explicit `{}`.
  void useConvexUser(api.auth.viewer, {})
  // @ts-expect-error canonical user queries require positional args
  void useConvexUser(api.auth.viewer)
  // @ts-expect-error required args must not be omittable
  void useConvexUser(api.files.getUrl)
  // @ts-expect-error wrong arg shape must not compile
  void useConvexUser(api.files.getUrl, { wrong: 1 })

  // --- defineSharedConvexQuery: args field always required, including `{}`
  // for a no-argument query ---
  defineSharedConvexQuery({ query: api.tasks.list, args: {} })
  // @ts-expect-error shared queries always declare args, even for no-arg queries
  defineSharedConvexQuery({ query: api.tasks.list })
  // @ts-expect-error required args field must not be omittable
  defineSharedConvexQuery({ query: api.files.getUrl })
  // @ts-expect-error wrong args field shape must not compile
  defineSharedConvexQuery({ query: api.files.getUrl, args: { wrong: 1 } })

  // --- useConvexStorageUrl: query must accept { storageId } and return string | null ---
  // Positive: correctly-typed getUrl query, with optional auth passthrough.
  void useConvexStorageUrl(api.files.getUrl, 'file_1')
  void useConvexStorageUrl(api.files.getUrl, 'file_1', { auth: 'required' })
  // @ts-expect-error mistyped getUrl query (wrong args/return) must not compile
  void useConvexStorageUrl(api.tasks.list, 'file_1')
}
void _requiredArgsContracts
