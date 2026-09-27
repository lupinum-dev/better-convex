/**
 * The one scenario suite for the public component-test runtime. Each variant
 * (standalone Vue, an embedded attached app, Nuxt) mounts the same components
 * through its own composables and installation path; the scenarios and their
 * expectations are shared, so the variants cannot drift.
 */
import type { FunctionReference, PaginationResult } from 'convex/server'
import { makeFunctionReference } from 'convex/server'
import { ConvexError } from 'convex/values'
import { describe, expect, it } from 'vitest'

import type {
  ConvexOperation,
  useConvexAction,
  useConvexFileUpload,
  useConvexMutation,
  useConvexOperation,
  useConvexPaginatedQuery,
  useConvexQuery,
} from '../../packages/vue/src'
import {
  invalidCursorError,
  setupBetterConvexTest,
  type BetterConvexTestRuntime,
} from '../../packages/vue/src/test'

export interface TestKitComposables {
  readonly useConvexQuery: typeof useConvexQuery
  readonly useConvexPaginatedQuery: typeof useConvexPaginatedQuery
  readonly useConvexMutation: typeof useConvexMutation
  readonly useConvexAction: typeof useConvexAction
  readonly useConvexFileUpload: typeof useConvexFileUpload
  readonly useConvexOperation: typeof useConvexOperation
}

export interface MountedScenario<State> {
  readonly state: State
  unmount(): void
}

export interface TestKitVariant {
  readonly name: string
  readonly composables: TestKitComposables
  /** Mount a component whose setup returns `state`, the way this variant installs Better Convex. */
  mount<State>(convex: BetterConvexTestRuntime, setup: () => State): Promise<MountedScenario<State>>
}

interface Note {
  readonly id: string
  readonly title: string
}

export const listNotes = makeFunctionReference<'query'>('notes:list') as FunctionReference<
  'query',
  'public',
  { owner: string },
  Note[]
>
export const pageNotes = makeFunctionReference<'query'>('notes:page') as FunctionReference<
  'query',
  'public',
  { folder: string; paginationOpts: { numItems: number; cursor: string | null } },
  PaginationResult<Note>
>
export const createNote = makeFunctionReference<'mutation'>('notes:create') as FunctionReference<
  'mutation',
  'public',
  { title: string },
  string
>
export const summarize = makeFunctionReference<'action'>('notes:summarize') as FunctionReference<
  'action',
  'public',
  { id: string },
  string
>
export const generateUploadUrl = makeFunctionReference<'mutation'>(
  'files:generateUploadUrl',
) as FunctionReference<'mutation', 'public', Record<string, never>, string>
export const attachFile = makeFunctionReference<'mutation'>('files:attach') as FunctionReference<
  'mutation',
  'public',
  { storageId: string },
  string
>

const note = (id: string): Note => ({ id, title: `Note ${id}` })
const textFile = (name = 'proof.txt') => new File(['proof'], name, { type: 'text/plain' })

export function defineTestKitScenarios(variant: TestKitVariant): void {
  const { composables } = variant

  async function mount<State>(convex: BetterConvexTestRuntime, setup: () => State) {
    const mounted = await variant.mount(convex, setup)
    await convex.flush()
    return mounted
  }

  describe(`test kit scenarios (${variant.name})`, () => {
    it('live query: update, then an identity switch resubscribes as the new user', async () => {
      const convex = setupBetterConvexTest({ auth: { subject: 'alice' } })
      const notes = convex.query(listNotes, { owner: 'alice' })
      notes.resolve([note('1')])
      const { state, unmount } = await mount(convex, () =>
        composables.useConvexQuery(listNotes, { owner: 'alice' }, { auth: 'required' }),
      )

      expect(state.data.value).toEqual([note('1')])
      notes.push([note('1'), note('2')])
      expect(state.data.value).toEqual([note('1'), note('2')])

      convex.auth.signIn('bob')
      await convex.flush()
      expect(notes.calls.map((call) => call.identity)).toEqual(['user:alice', 'user:bob'])
      expect(notes.activeSubscriptions()).toBe(1)

      convex.auth.signOut()
      await convex.flush()
      expect(state.status.value).toBe('idle')
      expect(notes.activeSubscriptions()).toBe(0)
      unmount()
      await convex.dispose()
    })

    it('mutation: start, reset, then the old response settles only its own promise', async () => {
      const convex = setupBetterConvexTest()
      const create = convex.mutation(createNote)
      const { state, unmount } = await mount(convex, () =>
        composables.useConvexMutation(createNote),
      )

      const first = state.mutate({ title: 'Draft' })
      const request = await create.nextCall()
      expect(request).toMatchObject({ args: { title: 'Draft' }, identity: 'user:test-user' })
      state.reset()
      expect(state.status.value).toBe('idle')

      request.resolve('note-1')
      await expect(first).resolves.toBe('note-1')
      expect(state.status.value).toBe('idle')
      expect(state.data.value).toBeUndefined()
      unmount()
      await convex.dispose()
    })

    it('mutation: an identity switch fences the old response as outcome unknown', async () => {
      const convex = setupBetterConvexTest({ auth: { subject: 'alice' } })
      const create = convex.mutation(createNote)
      const { state, unmount } = await mount(convex, () =>
        composables.useConvexMutation(createNote),
      )

      const pending = state.mutate({ title: 'Secret' })
      const request = await create.nextCall()
      convex.auth.signIn('bob')
      request.resolve('note-of-alice')

      await expect(pending).rejects.toMatchObject({
        code: 'IDENTITY_CHANGED',
        outcome: 'unknown',
        functionName: 'notes:create',
      })
      expect(state.data.value).toBeUndefined()
      expect(state.status.value).toBe('idle')
      unmount()
      await convex.dispose()
    })

    it('action: structured server failures keep their data and code', async () => {
      const convex = setupBetterConvexTest()
      convex.action(summarize).reject(new ConvexError({ code: 'QUOTA', message: 'Quota reached' }))
      const { state, unmount } = await mount(convex, () => composables.useConvexAction(summarize))

      await expect(state.run({ id: 'n1' })).rejects.toMatchObject({
        kind: 'server',
        code: 'QUOTA',
        message: 'Quota reached',
        functionName: 'notes:summarize',
      })
      expect(state.status.value).toBe('error')
      unmount()
      await convex.dispose()
    })

    it('pagination: first page, live update, then a later cursor fails with InvalidCursor', async () => {
      const convex = setupBetterConvexTest()
      const list = convex.paginatedQuery(pageNotes, { folder: 'inbox' })
      list.page().resolve({ page: [note('1')], isDone: false, continueCursor: 'c1' })
      const { state, unmount } = await mount(convex, () =>
        composables.useConvexPaginatedQuery(pageNotes, { folder: 'inbox' }, { initialNumItems: 1 }),
      )
      expect(state.data.value).toEqual([note('1')])

      list.page().push({ page: [note('1'), note('1b')], isDone: false, continueCursor: 'c1' })
      expect(state.data.value).toEqual([note('1'), note('1b')])

      const loading = state.loadMore(1)
      const later = list.page('c1')
      const pageCall = await later.nextCall()
      expect(pageCall.args).toMatchObject({ folder: 'inbox', paginationOpts: { cursor: 'c1' } })
      expect(state.isLoadingMore.value).toBe(true)

      later.reject(invalidCursorError())
      await loading
      await convex.flush()
      // Convex restarts the list from its first page; nothing stale survives.
      expect(state.data.value).toEqual([note('1'), note('1b')])
      expect(state.status.value).toBe('success')
      expect(state.error.value).toBeUndefined()
      expect(later.activeSubscriptions()).toBe(0)
      expect(list.page().activeSubscriptions()).toBe(1)
      unmount()
      await convex.dispose()
    })

    it('upload: progress and completion run the real storage transport', async () => {
      const convex = setupBetterConvexTest()
      const uploads = convex.upload(generateUploadUrl)
      const { state, unmount } = await mount(convex, () =>
        composables.useConvexFileUpload(generateUploadUrl),
      )
      const file = textFile()

      const pending = state.upload(file)
      const post = await uploads.nextCall()
      expect(post).toMatchObject({ file, contentType: 'text/plain' })
      post.progress(3, 5)
      expect(state.progress.value).toEqual({ loaded: 3, total: 5, percent: 60 })

      post.resolve('storage-1')
      await expect(pending).resolves.toMatchObject({ storageId: 'storage-1' })
      expect(state.status.value).toBe('success')
      expect(uploads.calls).toEqual([{ file, args: {} }])
      unmount()
      await convex.dispose()
    })

    it('upload: switch identity, then complete the old upload-URL response', async () => {
      const convex = setupBetterConvexTest({ auth: { subject: 'alice' } })
      const prepare = convex.mutation(generateUploadUrl)
      const { state, unmount } = await mount(convex, () =>
        composables.useConvexFileUpload(generateUploadUrl),
      )

      const pending = state.upload(textFile())
      const request = await prepare.nextCall()
      convex.auth.signIn('bob')
      request.resolve(convex.storage.url())

      await expect(pending).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
      await convex.flush()
      expect(convex.storage.calls).toEqual([])
      expect(state.status.value).toBe('idle')
      unmount()
      await convex.dispose()
    })

    it('upload: cancel aborts the in-flight file POST and returns to idle', async () => {
      const convex = setupBetterConvexTest()
      const uploads = convex.upload(generateUploadUrl)
      const { state, unmount } = await mount(convex, () =>
        composables.useConvexFileUpload(generateUploadUrl),
      )

      const pending = state.upload(textFile())
      const post = await uploads.nextCall()
      state.cancel()

      await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
      expect(post.state).toBe('aborted')
      expect(state.status.value).toBe('idle')
      unmount()
      await convex.dispose()
    })

    it('upload: a storage failure status becomes the upload error', async () => {
      const convex = setupBetterConvexTest()
      convex.upload(generateUploadUrl).fail(500, 'Server Error')
      const { state, unmount } = await mount(convex, () =>
        composables.useConvexFileUpload(generateUploadUrl),
      )

      await expect(state.upload(textFile())).rejects.toMatchObject({
        kind: 'transport',
        code: 'UPSTREAM_ERROR',
        status: 500,
      })
      expect(state.status.value).toBe('error')
      unmount()
      await convex.dispose()
    })

    it('upload: client-side validation never reaches the transport', async () => {
      const convex = setupBetterConvexTest()
      const uploads = convex.upload(generateUploadUrl)
      const prepare = convex.mutation(generateUploadUrl)
      const { state, unmount } = await mount(convex, () =>
        composables.useConvexFileUpload(generateUploadUrl, { maxSize: 2 }),
      )

      await expect(state.upload(textFile())).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
      expect(prepare.calls).toEqual([])
      expect(uploads.calls).toEqual([])
      unmount()
      await convex.dispose()
    })
    it('upload with complete: switch identity, then answer the old completion', async () => {
      const convex = setupBetterConvexTest({ auth: { subject: 'alice' } })
      const uploads = convex.upload(generateUploadUrl)
      const attach = convex.mutation(attachFile)
      const { state, unmount } = await mount(convex, () =>
        composables.useConvexFileUpload(generateUploadUrl, {
          complete: (op, { storageId }) => op.mutation(attachFile, { storageId }),
        }),
      )

      const pending = state.upload(textFile())
      ;(await uploads.nextCall()).resolve('storage-of-alice')
      const completion = await attach.nextCall()
      expect(completion).toMatchObject({
        args: { storageId: 'storage-of-alice' },
        identity: 'user:alice',
      })
      expect(state.pending.value).toBe(true)
      convex.auth.signIn('bob')
      completion.resolve('attachment-of-alice')

      await expect(pending).rejects.toMatchObject({
        code: 'IDENTITY_CHANGED',
        phase: 'complete',
        outcome: 'unknown',
      })
      expect(state.data.value).toBeUndefined()
      expect(state.status.value).toBe('idle')
      unmount()
      await convex.dispose()
    })

    it('operation: prepare, upload, attach; a switch mid-upload sends nothing more', async () => {
      const convex = setupBetterConvexTest({ auth: { subject: 'alice' } })
      convex.mutation(generateUploadUrl).respond(() => convex.storage.url())
      const attach = convex.mutation(attachFile)
      let op!: ConvexOperation
      const { state, unmount } = await mount(convex, () =>
        composables.useConvexOperation(async (operation, file: File) => {
          op = operation
          const url = await operation.mutation(generateUploadUrl)
          const storageId = await operation.upload(url, file)
          return operation.mutation(attachFile, { storageId })
        }),
      )

      const publishing = state.run(textFile())
      const post = await convex.storage.nextCall()
      convex.auth.signIn('bob')

      await expect(publishing).rejects.toMatchObject({
        code: 'IDENTITY_CHANGED',
        outcome: 'unknown',
      })
      expect(post.state).toBe('aborted')
      expect(state.status.value).toBe('idle')
      expect(state.error.value).toBeUndefined()
      expect(op.retired).toBe(true)
      await expect(op.mutation(attachFile, { storageId: 'storage-1' })).rejects.toMatchObject({
        code: 'IDENTITY_CHANGED',
        outcome: 'not-sent',
      })
      expect(attach.calls).toEqual([])
      unmount()
      await convex.dispose()
    })

    it('operation: every step is sent as the identity the run began with', async () => {
      const convex = setupBetterConvexTest({ auth: { subject: 'alice' } })
      const create = convex.mutation(createNote)
      create.resolve('n1')
      const summary = convex.action(summarize)
      let op!: ConvexOperation
      const { state, unmount } = await mount(convex, () =>
        composables.useConvexOperation(async (operation) => {
          op = operation
          const id = await operation.mutation(createNote, { title: 'A' })
          return operation.action(summarize, { id })
        }),
      )

      const running = state.run()
      const request = await summary.nextCall()
      expect([create.calls[0]?.identity, request.identity]).toEqual(['user:alice', 'user:alice'])

      state.reset()
      expect(state.status.value).toBe('idle')
      request.resolve('sent before reset')
      await expect(running).resolves.toBe('sent before reset')
      expect(state.data.value).toBeUndefined()
      await expect(op.mutation(createNote, { title: 'B' })).rejects.toMatchObject({
        code: 'CANCELLED',
        outcome: 'not-sent',
      })
      expect(create.calls).toHaveLength(1)
      unmount()
      await convex.dispose()
    })
  })
}
