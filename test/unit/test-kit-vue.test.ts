// @vitest-environment happy-dom
import type { FunctionReference } from 'convex/server'
import { makeFunctionReference } from 'convex/server'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'

import {
  createBetterConvex,
  useConvexAction,
  useConvexConnectionState,
  useConvexFileUpload,
  useConvexMutation,
  useConvexOperation,
  useConvexPaginatedQuery,
  useConvexQuery,
} from '../../packages/vue/src'
import { setupBetterConvexTest, type BetterConvexTestRuntime } from '../../packages/vue/src/test'
import {
  createNote,
  defineTestKitScenarios,
  generateUploadUrl,
  listNotes,
  pageNotes,
  type TestKitComposables,
} from './test-kit-scenarios'

const composables: TestKitComposables = {
  useConvexQuery,
  useConvexPaginatedQuery,
  useConvexMutation,
  useConvexAction,
  useConvexFileUpload,
  useConvexOperation,
}

const prepareUpload = makeFunctionReference<'mutation'>('files:prepare') as FunctionReference<
  'mutation',
  'public',
  { folder: string },
  { uploadUrl: string; sessionId: string }
>

const mountedApps = new Set<App>()

afterEach(() => {
  for (const app of mountedApps) app.unmount()
  mountedApps.clear()
  document.body.innerHTML = ''
})

function mountApp(app: App): App {
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  mountedApps.add(app)
  return app
}

function probe<State>(setup: () => State, capture: (state: State) => void) {
  return defineComponent({
    setup() {
      capture(setup())
      return () => h('div')
    },
  })
}

function mountStandalone<State>(convex: BetterConvexTestRuntime, setup: () => State) {
  let state!: State
  const app = mountApp(createApp(probe(setup, (value) => (state = value))).use(convex.plugin))
  return {
    state,
    unmount() {
      if (mountedApps.delete(app)) app.unmount()
    },
  }
}

// An embedded application: a separately created Vue app that attaches to the
// host's runtime through the frozen attachment, as `useConvexAttachment()` hands it out.
function mountEmbedded<State>(convex: BetterConvexTestRuntime, setup: () => State) {
  const host = mountApp(createApp({ render: () => h('div') }).use(convex.plugin))
  let state!: State
  const embedded = mountApp(
    createApp(probe(setup, (value) => (state = value))).use(
      createBetterConvex({ attachment: convex.plugin.attachment() }),
    ),
  )
  return {
    state,
    unmount() {
      if (mountedApps.delete(embedded)) embedded.unmount()
      if (mountedApps.delete(host)) host.unmount()
    },
  }
}

defineTestKitScenarios({
  name: 'standalone Vue',
  composables,
  mount: async (convex, setup) => mountStandalone(convex, setup),
})

defineTestKitScenarios({
  name: 'embedded attachment',
  composables,
  mount: async (convex, setup) => mountEmbedded(convex, setup),
})

describe('setupBetterConvexTest (Vue)', () => {
  it('answers requests by function reference, with sticky and per-request answers', async () => {
    const convex = setupBetterConvexTest()
    const create = convex.mutation(createNote)
    const { state } = mountStandalone(convex, () => useConvexMutation(createNote))

    const first = state.mutate({ title: 'A' })
    const second = state.mutate({ title: 'B' })
    await convex.flush()
    expect(create.calls).toEqual([
      { args: { title: 'A' }, identity: 'user:test-user' },
      { args: { title: 'B' }, identity: 'user:test-user' },
    ])
    create.calls[1]!.resolve('b')
    await expect(second).resolves.toBe('b')
    expect(create.calls.map((call) => call.state)).toEqual(['pending', 'resolved'])

    create.respond(({ title }) => `id-${title}`)
    await expect(first).resolves.toBe('id-A')
    await expect(state.mutate({ title: 'C' })).resolves.toBe('id-C')
    expect(() => create.calls[0]!.resolve('again')).toThrow(/already resolved/)
    await convex.dispose()
  })

  it('reports a missing call instead of hanging', async () => {
    const convex = setupBetterConvexTest()
    await expect(convex.mutation(createNote).nextCall()).rejects.toThrow(/no mutation notes:create/)
    await convex.dispose()
  })

  it('never sends a request started before sign-in as the signed-in user', async () => {
    const convex = setupBetterConvexTest({ auth: 'loading' })
    const create = convex.mutation(createNote)
    const { state } = mountStandalone(convex, () => useConvexMutation(createNote))

    const early = state.mutate({ title: 'Early' })
    await convex.flush()
    expect(create.calls).toEqual([])

    convex.auth.signIn('carol')
    await expect(early).rejects.toMatchObject({ code: 'IDENTITY_CHANGED', outcome: 'not-sent' })
    expect(create.calls).toEqual([])

    const next = state.mutate({ title: 'After sign-in' })
    const request = await create.nextCall()
    expect(request.identity).toBe('user:carol')
    request.resolve('n1')
    await expect(next).resolves.toBe('n1')
    await convex.dispose()
  })

  it('treats a renewed session of the same subject as a new identity', async () => {
    const convex = setupBetterConvexTest({ auth: { subject: 'alice' } })
    const create = convex.mutation(createNote)
    const { state } = mountStandalone(convex, () => useConvexMutation(createNote))

    const pending = state.mutate({ title: 'Before renewal' })
    const request = await create.nextCall()
    convex.auth.renewSession()
    request.resolve('stale')
    await expect(pending).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
    await convex.dispose()
  })

  it('publishes transport facts to useConvexConnectionState', async () => {
    const convex = setupBetterConvexTest()
    const { state } = mountStandalone(convex, () => useConvexConnectionState())
    await convex.flush()
    expect(state.isConnected.value).toBe(true)

    convex.setConnectionState({ isWebSocketConnected: false })
    expect(state.isReconnecting.value).toBe(true)
    await convex.dispose()
  })

  it('runs without auth for an application that has none', async () => {
    const convex = setupBetterConvexTest({ auth: false })
    const create = convex.mutation(createNote)
    create.resolve('n1')
    const { state } = mountStandalone(convex, () => useConvexMutation(createNote))

    await expect(state.mutate({ title: 'Anonymous' })).resolves.toBe('n1')
    expect(create.calls[0]?.identity).toBe('anonymous')
    expect(() => convex.auth.signIn()).toThrow(/auth: false/)
    await convex.dispose()
  })

  it('answers every argument variant by default while exact arguments win', async () => {
    const convex = setupBetterConvexTest()
    const all = convex.query(listNotes)
    all.resolve([{ id: 'shared', title: 'Shared' }])
    convex.query(listNotes, { owner: 'romi' }).resolve([{ id: 'r', title: 'Romi' }])
    const { state, unmount } = mountStandalone(convex, () => [
      useConvexQuery(listNotes, { owner: 'alice' }),
      useConvexQuery(listNotes, { owner: 'romi' }),
    ])
    await convex.flush()

    expect(state.map((query) => query.data.value)).toEqual([
      [{ id: 'shared', title: 'Shared' }],
      [{ id: 'r', title: 'Romi' }],
    ])
    expect(all.calls).toEqual([
      { kind: 'subscribe', args: { owner: 'alice' }, identity: 'user:test-user' },
      { kind: 'subscribe', args: { owner: 'romi' }, identity: 'user:test-user' },
    ])
    all.push([])
    expect(state.map((query) => query.data.value)).toEqual([[], [{ id: 'r', title: 'Romi' }]])
    expect(all.activeSubscriptions()).toBe(2)
    unmount()
    expect(all.activeSubscriptions()).toBe(0)
    await convex.dispose()
  })

  it('keeps pages of different list arguments apart', async () => {
    const convex = setupBetterConvexTest()
    const inbox = convex.paginatedQuery(pageNotes, { folder: 'inbox' })
    const archive = convex.paginatedQuery(pageNotes, { folder: 'archive' })
    inbox.page().resolve({ page: [{ id: 'i', title: 'In' }], isDone: true, continueCursor: 'end' })
    archive.page().resolve({ page: [], isDone: true, continueCursor: 'end' })
    const { state } = mountStandalone(convex, () =>
      useConvexPaginatedQuery(pageNotes, { folder: 'inbox' }, { initialNumItems: 5 }),
    )
    await convex.flush()

    expect(state.data.value).toEqual([{ id: 'i', title: 'In' }])
    expect(state.isExhausted.value).toBe(true)
    expect(inbox.calls).toHaveLength(1)
    expect(archive.calls).toEqual([])
    await convex.dispose()
  })

  it('answers an upload-URL mutation that returns more than the URL', async () => {
    const convex = setupBetterConvexTest()
    const uploads = convex.upload(prepareUpload, {
      prepared: (uploadUrl, { folder }) => ({ uploadUrl, sessionId: `session-${folder}` }),
    })
    uploads.resolve('storage-1')
    const { state } = mountStandalone(convex, () =>
      useConvexFileUpload(prepareUpload, { url: (prepared) => prepared.uploadUrl }),
    )
    const file = new File(['x'], 'x.txt', { type: 'text/plain' })

    await expect(state.upload(file, { folder: 'docs' })).resolves.toMatchObject({
      storageId: 'storage-1',
      prepared: { sessionId: 'session-docs' },
    })
    expect(uploads.calls).toEqual([{ file, args: { folder: 'docs' } }])
    await convex.dispose()
  })

  it('reports a dropped storage connection as a network failure that may have stored', async () => {
    const convex = setupBetterConvexTest()
    const uploads = convex.upload(generateUploadUrl)
    const { state } = mountStandalone(convex, () => useConvexFileUpload(generateUploadUrl))

    const pending = state.upload(new File(['x'], 'x.txt', { type: 'text/plain' }))
    ;(await uploads.nextCall()).networkError()
    await expect(pending).rejects.toMatchObject({
      kind: 'transport',
      code: 'NETWORK_ERROR',
      phase: 'upload',
      outcome: 'unknown',
    })
    await convex.dispose()
  })

  it('fails the upload-URL mutation itself with reject()', async () => {
    const convex = setupBetterConvexTest()
    const uploads = convex.upload(generateUploadUrl)
    uploads.reject(new Error('storage quota exceeded'))
    const { state } = mountStandalone(convex, () => useConvexFileUpload(generateUploadUrl))

    await expect(
      state.upload(new File(['x'], 'x.txt', { type: 'text/plain' })),
    ).rejects.toMatchObject({ phase: 'prepare', functionName: 'files:generateUploadUrl' })
    expect(uploads.calls).toEqual([])
    await convex.dispose()
  })

  it('restores the environment XMLHttpRequest when disposed', async () => {
    const original = globalThis.XMLHttpRequest
    const convex = setupBetterConvexTest()
    convex.upload(generateUploadUrl)
    convex.storage.url()
    expect(globalThis.XMLHttpRequest).not.toBe(original)

    await convex.dispose()
    expect(globalThis.XMLHttpRequest).toBe(original)
  })
})
