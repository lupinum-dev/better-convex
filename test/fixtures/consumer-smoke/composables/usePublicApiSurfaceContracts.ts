import { defineConvexAuthClient } from '@lupinum/better-convex-nuxt/auth-client'
import type { ConvexAuthClientDefinition } from '@lupinum/better-convex-nuxt/auth-client'
import type { OptimisticLocalStore } from 'convex/browser'
import type { GenericId } from 'convex/values'
import type { ComputedRef, Ref } from 'vue'
import { ref } from 'vue'

import { api } from '#convex/api'

function assertType<T>(_value: T): void {}

export async function usePublicApiSurfaceContracts(file: File) {
  const auth = useConvexAuth()
  assertType<Ref<boolean>>(auth.isPending)
  assertType<'loading' | 'anonymous' | 'authenticated' | 'error'>(auth.status.value)
  assertType<string | undefined>(auth.user.value?.id)
  assertType<Error | undefined>(auth.error.value)

  const config = useConvexConfig()
  assertType<string | undefined>(config.url)
  // @ts-expect-error `useConvexConfig()` returns a read-only projection
  //  — every field is `readonly`, so assignment must not compile.
  config.url = 'https://mutated.convex.cloud'
  assertType<string | undefined>(config.siteUrl)
  // @ts-expect-error auth and proxy policy are internal runtime concerns
  void config.auth
  // @ts-expect-error query transport policy is per call, not global runtime config
  void config.defaults
  // @ts-expect-error upload orchestration is application-owned
  void config.upload

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

  const liveList = useConvexQuery(api.tasks.list)
  assertType<Promise<unknown>>(liveList)
  assertType<ComputedRef<string[] | undefined>>(liveList.data)
  const list = await liveList
  assertType<ComputedRef<boolean>>(list.isStale)
  assertType<string[]>(list.data.value ?? [])

  const skipped = await useConvexQuery(api.tasks.list, 'skip')
  assertType<'idle' | 'pending' | 'success' | 'error'>(skipped.status.value)

  const paginated = useConvexPaginatedQuery(api.tasks.listPaginated, {}, { initialNumItems: 5 })
  assertType<Promise<unknown>>(paginated)
  assertType<ComputedRef<readonly string[] | undefined>>(paginated.data)
  assertType<'idle' | 'pending' | 'success' | 'error'>(paginated.status.value)
  assertType<boolean>(paginated.isLoading.value)
  assertType<boolean>(paginated.canLoadMore.value)
  assertType<Error | undefined>(paginated.error.value)
  assertType<boolean>(paginated.isStale.value)
  paginated.loadMore(5)
  assertType<Promise<void>>(paginated.refresh())
  const settledPagination = await paginated
  assertType<readonly string[]>(settledPagination.data.value ?? [])
  // @ts-expect-error legacy tuple vocabulary was removed
  void settledPagination.results
  // @ts-expect-error Nuxt hydration settlement is private
  void settledPagination.firstPageSettled

  const createTask = useConvexMutation(api.tasks.create, {
    optimisticUpdate(store, args) {
      assertType<OptimisticLocalStore>(store)
      assertType<string>(args.text)
      const current = store.getQuery(api.tasks.list, {})
      store.setQuery(api.tasks.list, {}, current ? [...current, args.text] : current)
    },
  })
  assertType<string>(await createTask({ text: 'callable' }))
  assertType<boolean>(createTask.pending.value)
  // @ts-expect-error callable lifecycle state is readonly
  createTask.data.value = 'mutated'
  // @ts-expect-error one rejected-Promise protocol; `.safe` was removed
  void createTask.safe({ text: 'removed' })

  const sendEmail = useConvexAction(api.emails.send)
  assertType<{ ok: boolean }>(await sendEmail({ to: 'team@example.com', subject: 'Smoke' }))
  // @ts-expect-error actions have no callback options or alternate execution protocol
  void sendEmail.safe({ to: 'team@example.com', subject: 'Removed' })

  const upload = useConvexFileUpload(api.files.generateUploadUrl)
  assertType<GenericId<'_storage'>>(await upload.upload(file))
  assertType<ComputedRef<GenericId<'_storage'> | undefined>>(upload.data)
  assertType<number>(upload.progress.value.percent)
  const uploadedUrl = useConvexQuery(
    api.files.getUrl,
    () => (upload.data.value ? { storageId: upload.data.value } : 'skip'),
    { auth: 'required' },
  )
  assertType<ComputedRef<string | null | undefined>>(uploadedUrl.data)

  // The framework-free typed client definition comes from the auth-client entry. The
  // plugin-typed narrowing of `useConvexAuth().client` is proven end-to-end in
  // the single-`better-auth`-copy packed fixture `test/fixtures/auth-client-typing`;
  // this linked smoke only pins the value + empty-definition type surface.
  const emptyDefinition = defineConvexAuthClient()
  assertType<ConvexAuthClientDefinition<[]>>(emptyDefinition)
}

function _callableContracts() {
  // @ts-expect-error optimistic updates must complete synchronously
  useConvexMutation(api.tasks.create, {
    async optimisticUpdate() {},
  })

  const thenableUpdate = () => ({ then() {} })
  // @ts-expect-error arbitrary Promise-like returns are also forbidden
  useConvexMutation(api.tasks.create, {
    optimisticUpdate: thenableUpdate,
  })

  useConvexMutation(api.tasks.create, {
    // @ts-expect-error completion belongs in ordinary await/catch control flow
    onSuccess() {},
  })
  // @ts-expect-error actions expose no options bag
  useConvexAction(api.emails.send, { onError() {} })
}
void _callableContracts

function _uploadContracts(file: File) {
  const noArgs = useConvexFileUpload(api.files.generateUploadUrl)
  void noArgs.upload(file)
  void noArgs.upload(file, {})

  const requiredArgs = useConvexFileUpload(api.files.generateWorkspaceUploadUrl)
  void requiredArgs.upload(file, { workspaceId: 'workspace_1' })
  // @ts-expect-error generated validator-required args cannot be omitted
  void requiredArgs.upload(file)
  // @ts-expect-error generated validator-derived args reject the wrong shape
  void requiredArgs.upload(file, {})

  // @ts-expect-error generateUploadUrl must return string
  useConvexFileUpload(api.files.invalidUploadUrl)
  // @ts-expect-error completion is observed through await/catch, not callbacks
  useConvexFileUpload(api.files.generateUploadUrl, { onSuccess: () => {} })
  // @ts-expect-error progress is readonly state, not a callback
  useConvexFileUpload(api.files.generateUploadUrl, { onProgress: () => {} })
}

/**
 * Public call-arity contracts. These calls pin the required args position and
 * accepted query argument shapes against the packed package.
 */
async function _requiredArgsContracts() {
  // --- useConvexQuery: exactly-empty functions may omit args. ---
  // Positive: both the concise and explicit forms compile.
  void useConvexQuery(api.tasks.list)
  void useConvexQuery(api.tasks.list, {})
  void useConvexQuery(api.tasks.list, {}, { server: false })
  // Positive: the skip sentinel is the only other legal args-slot value.
  void useConvexQuery(api.tasks.list, 'skip')
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
  void useConvexPaginatedQuery(api.tasks.listPaginated, {}, { initialNumItems: 5 })
  void useConvexPaginatedQuery(api.tasks.listPaginated, 'skip', { initialNumItems: 5 })
  // @ts-expect-error pagination options and initialNumItems are required
  void useConvexPaginatedQuery(api.tasks.listPaginated, {})
  // @ts-expect-error paginated queries never omit the args slot either
  void useConvexPaginatedQuery(api.tasks.listPaginated)
  // @ts-expect-error null is not the paginated skip sentinel
  void useConvexPaginatedQuery(api.tasks.listPaginated, null, { initialNumItems: 5 })
  // @ts-expect-error undefined is not the paginated skip sentinel
  void useConvexPaginatedQuery(api.tasks.listPaginated, undefined, { initialNumItems: 5 })
  // @ts-expect-error a ref containing null is not the paginated skip sentinel
  void useConvexPaginatedQuery(api.tasks.listPaginated, ref(null), { initialNumItems: 5 })
  // @ts-expect-error a ref containing undefined is not the paginated skip sentinel
  void useConvexPaginatedQuery(api.tasks.listPaginated, ref(undefined), { initialNumItems: 5 })
  // @ts-expect-error a getter returning null is not the paginated skip sentinel
  void useConvexPaginatedQuery(api.tasks.listPaginated, () => null, { initialNumItems: 5 })
  // @ts-expect-error a getter returning undefined is not the paginated skip sentinel
  void useConvexPaginatedQuery(api.tasks.listPaginated, () => undefined, { initialNumItems: 5 })
  // Positive: correct required extra args compile.
  void useConvexPaginatedQuery(
    api.tasks.listPaginatedByOwner,
    { owner: 'user_1' },
    { initialNumItems: 5 },
  )
  // @ts-expect-error required paginated args must not be omittable
  void useConvexPaginatedQuery(api.tasks.listPaginatedByOwner)
  // @ts-expect-error wrong paginated arg shape must not compile
  void useConvexPaginatedQuery(api.tasks.listPaginatedByOwner, { wrong: 1 }, { initialNumItems: 5 })
}
void _requiredArgsContracts
