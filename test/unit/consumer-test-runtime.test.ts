// @vitest-environment happy-dom
import type { FunctionReference } from 'convex/server'
import { makeFunctionReference } from 'convex/server'
import { ConvexError, type GenericId } from 'convex/values'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'

import { setupBetterConvexTest } from '../../src/runtime/test'

const listNotes = makeFunctionReference<'query'>('notes:list') as FunctionReference<
  'query',
  'public',
  { owner: string },
  string[]
>
const createNote = makeFunctionReference<'mutation'>('notes:create') as FunctionReference<
  'mutation',
  'public',
  { title: string },
  string
>
const generateUploadUrl = makeFunctionReference<'mutation'>(
  'files:generateUploadUrl',
) as FunctionReference<'mutation', 'public', Record<string, never>, string>

afterEach(() => {
  document.body.innerHTML = ''
})

function mountRuntime(runtime: ReturnType<typeof setupBetterConvexTest>, setup: () => void) {
  const app = createApp(
    defineComponent({
      setup() {
        setup()
        return () => h('div')
      },
    }),
  )
  app.use(runtime.plugin)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return app
}

describe('setupBetterConvexTest', () => {
  it('drives real query lifecycle state by function reference and arguments', async () => {
    const runtime = setupBetterConvexTest()
    const notes = runtime.query(listNotes, { owner: 'matthias' })
    notes.resolve(['First'])
    let state!: ReturnType<typeof runtime.composables.useConvexQuery<typeof listNotes>>
    const app = mountRuntime(runtime, () => {
      state = runtime.composables.useConvexQuery(
        listNotes,
        { owner: 'matthias' },
        {
          auth: 'required',
        },
      )
    })

    expect(state.status.value).toBe('pending')
    await nextTick()
    await Promise.resolve()
    expect(state.status.value).toBe('success')
    expect(state.data.value).toEqual(['First'])
    expect(notes.calls).toEqual([{ kind: 'subscribe', args: { owner: 'matthias' } }])

    notes.push(['First', 'Second'])
    expect(state.data.value).toEqual(['First', 'Second'])

    runtime.auth.signOut()
    await nextTick()
    expect(state.status.value).toBe('idle')
    expect(notes.activeSubscriptions()).toBe(0)
    app.unmount()
  })

  it('settles pending writes and records typed arguments without call-order mocks', async () => {
    const runtime = setupBetterConvexTest()
    const create = runtime.mutation(createNote)
    let mutation!: ReturnType<typeof runtime.composables.useConvexMutation<typeof createNote>>
    const app = mountRuntime(runtime, () => {
      mutation = runtime.composables.useConvexMutation(createNote)
    })

    const result = mutation({ title: 'Proof' })
    expect(mutation.pending.value).toBe(true)
    await Promise.resolve()
    expect(create.calls).toEqual([{ args: { title: 'Proof' } }])

    create.resolve('note-id')
    await expect(result).resolves.toBe('note-id')
    expect(mutation.status.value).toBe('success')
    expect(mutation.data.value).toBe('note-id')
    app.unmount()
  })

  it('preserves structured write failures and recovers on the next configured result', async () => {
    const runtime = setupBetterConvexTest()
    const create = runtime.mutation(createNote)
    create.reject(new ConvexError({ code: 'NOTE_EXISTS' }))
    let mutation!: ReturnType<typeof runtime.composables.useConvexMutation<typeof createNote>>
    const app = mountRuntime(runtime, () => {
      mutation = runtime.composables.useConvexMutation(createNote)
    })

    await expect(mutation({ title: 'Duplicate' })).rejects.toMatchObject({
      data: { code: 'NOTE_EXISTS' },
    })
    expect(mutation.status.value).toBe('error')

    create.resolve('note-new')
    await expect(mutation({ title: 'New' })).resolves.toBe('note-new')
    expect(mutation.status.value).toBe('success')
    expect(create.calls).toEqual([{ args: { title: 'Duplicate' } }, { args: { title: 'New' } }])
    app.unmount()
  })

  it('supports one default query behavior while retaining argument-specific call evidence', async () => {
    const runtime = setupBetterConvexTest()
    const allNotes = runtime.query(listNotes)
    allNotes.resolve(['Shared'])
    const states: Array<ReturnType<typeof runtime.composables.useConvexQuery<typeof listNotes>>> =
      []
    const app = mountRuntime(runtime, () => {
      states.push(
        runtime.composables.useConvexQuery(listNotes, { owner: 'alice' }),
        runtime.composables.useConvexQuery(listNotes, { owner: 'romi' }),
      )
    })

    await Promise.resolve()
    expect(states.map((state) => state.data.value)).toEqual([['Shared'], ['Shared']])
    expect(allNotes.calls).toEqual([
      { kind: 'subscribe', args: { owner: 'alice' } },
      { kind: 'subscribe', args: { owner: 'romi' } },
    ])
    expect(allNotes.activeSubscriptions()).toBe(2)
    app.unmount()
    expect(allNotes.activeSubscriptions()).toBe(0)
  })

  it('uses the public auth vocabulary for sign-out and sanitized failure states', () => {
    const runtime = setupBetterConvexTest()
    expect(runtime.auth.status.value).toBe('authenticated')

    runtime.auth.signOut()
    expect(runtime.auth.status.value).toBe('anonymous')

    runtime.auth.fail(new Error('provider unavailable'))
    expect(runtime.auth.status.value).toBe('error')
    expect(runtime.auth.error.value).toMatchObject({
      kind: 'authentication',
      message: 'provider unavailable',
    })
  })

  it('honors auth readiness timeout without inventing a settled identity', async () => {
    const runtime = setupBetterConvexTest({ auth: 'loading' })

    await expect(runtime.auth.ready({ timeoutMs: 1 })).resolves.toBe('loading')
    runtime.auth.signIn()
    await expect(runtime.auth.ready()).resolves.toBe('authenticated')
  })

  it('models upload progress, completion, and typed call evidence', async () => {
    const runtime = setupBetterConvexTest()
    const uploadControl = runtime.upload(generateUploadUrl)
    let upload!: ReturnType<
      typeof runtime.composables.useConvexFileUpload<typeof generateUploadUrl>
    >
    const app = mountRuntime(runtime, () => {
      upload = runtime.composables.useConvexFileUpload(generateUploadUrl)
    })
    const file = new File(['proof'], 'proof.txt', { type: 'text/plain' })

    const result = upload.upload(file)
    expect(upload.pending.value).toBe(true)
    uploadControl.progress({ loaded: 3, total: 5, percent: 60 })
    expect(upload.progress.value.percent).toBe(60)

    uploadControl.resolve('storage-proof' as GenericId<'_storage'>)
    await expect(result).resolves.toBe('storage-proof')
    expect(upload.status.value).toBe('success')
    expect(uploadControl.calls).toEqual([{ file, args: {} }])
    app.unmount()
  })

  it('keeps cancellation idle and isolates a replacement upload', async () => {
    const runtime = setupBetterConvexTest()
    const uploadControl = runtime.upload(generateUploadUrl)
    let upload!: ReturnType<
      typeof runtime.composables.useConvexFileUpload<typeof generateUploadUrl>
    >
    const app = mountRuntime(runtime, () => {
      upload = runtime.composables.useConvexFileUpload(generateUploadUrl)
    })
    const first = upload.upload(new File(['first'], 'first.txt', { type: 'text/plain' }))

    upload.cancel()
    const second = upload.upload(new File(['second'], 'second.txt', { type: 'text/plain' }))
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(upload.status.value).toBe('pending')

    uploadControl.resolve('storage-second' as GenericId<'_storage'>)
    await expect(second).resolves.toBe('storage-second')
    expect(upload.status.value).toBe('success')
    app.unmount()
  })
})
