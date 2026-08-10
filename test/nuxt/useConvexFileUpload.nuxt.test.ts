import type { FunctionReference } from 'convex/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'

import { useConvexFileUpload } from '../../src/runtime/composables/useConvexFileUpload'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt, installIdentityPortHarness } from '../helpers/nuxt-runtime-harness'
import { waitFor } from '../helpers/wait-for'

interface FakeUploadListenerMap {
  onprogress: ((event: ProgressEvent) => void) | null
}

class FakeXhr {
  static next = {
    status: 200,
    responseText: JSON.stringify({ storageId: 'storage_1' }),
  }
  static delayMs = 0

  upload: FakeUploadListenerMap = { onprogress: null }
  status = 0
  statusText = ''
  responseText = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null

  open(_method: string, _url: string) {}
  setRequestHeader(_k: string, _v: string) {}

  send(_file: File) {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: 5,
      total: 10,
    } as ProgressEvent)
    setTimeout(() => {
      this.status = FakeXhr.next.status
      this.responseText = FakeXhr.next.responseText
      this.onload?.()
    }, FakeXhr.delayMs)
  }

  abort() {
    this.onabort?.()
  }
}

const originalXhr = globalThis.XMLHttpRequest

beforeEach(() => {
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest
  FakeXhr.next = {
    status: 200,
    responseText: JSON.stringify({ storageId: 'storage_1' }),
  }
  FakeXhr.delayMs = 0
})

afterAll(() => {
  globalThis.XMLHttpRequest = originalXhr
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useConvexFileUpload (Nuxt runtime)', () => {
  it('can be created without a live transport and safely normalizes execution failure', async () => {
    const mutation = mockFnRef<'mutation'>('files:ssr-safe-upload-url')

    const { result } = await captureInNuxt(() => useConvexFileUpload(mutation))
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })

    expect(result.status.value).toBe('idle')
    await expect(result.upload(file)).rejects.toThrow('Unknown Convex error')
    expect(result.status.value).toBe('error')
    expect(result.pending.value).toBe(false)
    expect(result.error.value?.kind).toBe('unknown')
  })

  it('uploads file, tracks progress, and stores returned storageId', async () => {
    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:generateUploadUrl')
    convex.setMutationHandler('files:generateUploadUrl', async () => 'http://upload.local')

    const { result } = await captureInNuxt(() => useConvexFileUpload(mutation), { convex })
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })

    const storageId = await result.upload(file)

    expect(storageId).toBe('storage_1')
    expect(result.progress.value).toEqual({ loaded: 5, total: 10, percent: 50 })
    expect(result.status.value).toBe('success')
    expect(result.data.value).toBe('storage_1')
    expect(result.error.value).toBeUndefined()
  })

  it('forwards validator-derived required args to the upload URL mutation', async () => {
    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:generateWorkspaceUploadUrl') as FunctionReference<
      'mutation',
      'public',
      { workspaceId: string },
      string
    >
    convex.setMutationHandler('files:generateWorkspaceUploadUrl', async () => 'http://upload.local')

    const { result } = await captureInNuxt(() => useConvexFileUpload(mutation), { convex })
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })

    await result.upload(file, { workspaceId: 'workspace_1' })

    expect(convex.calls.mutation[0]?.args).toEqual({ workspaceId: 'workspace_1' })
  })

  it('rejects an invalid upload URL mutation result before starting XHR', async () => {
    const sendSpy = vi.spyOn(FakeXhr.prototype, 'send')
    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:invalidUploadUrl')
    convex.setMutationHandler('files:invalidUploadUrl', async () => 42)

    const { result } = await captureInNuxt(() => useConvexFileUpload(mutation), { convex })

    await expect(
      result.upload(new File(['hello'], 'hello.txt', { type: 'text/plain' })),
    ).rejects.toThrow('must return a string URL')
    expect(sendSpy).not.toHaveBeenCalled()
    expect(result.status.value).toBe('error')
    expect(result.error.value?.message).toContain('must return a string URL')
    sendSpy.mockRestore()
  })

  it.each([
    ['missing', JSON.stringify({})],
    ['empty', JSON.stringify({ storageId: '' })],
    ['wrong type', JSON.stringify({ storageId: 42 })],
    ['invalid JSON', '{'],
  ])('rejects an %s storage ID response before branding it', async (_case, responseText) => {
    FakeXhr.next = { status: 200, responseText }
    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:invalidStorageId')
    convex.setMutationHandler('files:invalidStorageId', async () => 'http://upload.local')

    const { result } = await captureInNuxt(() => useConvexFileUpload(mutation), { convex })

    await expect(
      result.upload(new File(['hello'], 'hello.txt', { type: 'text/plain' })),
    ).rejects.toThrow()
    expect(result.status.value).toBe('error')
    expect(result.data.value).toBeUndefined()
  })

  it('publishes byte-level progress as readonly composable state', async () => {
    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:generateUploadUrl:on-progress')
    convex.setMutationHandler(
      'files:generateUploadUrl:on-progress',
      async () => 'http://upload.local',
    )
    const { result } = await captureInNuxt(() => useConvexFileUpload(mutation), { convex })
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })

    await result.upload(file)

    expect(result.progress.value).toEqual({ loaded: 5, total: 10, percent: 50 })
  })

  it('validates allowedTypes and reports errors deterministically', async () => {
    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:generateUploadUrl')
    convex.setMutationHandler('files:generateUploadUrl', async () => 'http://upload.local')
    const { result } = await captureInNuxt(
      () => useConvexFileUpload(mutation, { allowedTypes: ['image/*'] }),
      { convex },
    )

    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    await expect(result.upload(file)).rejects.toThrow('not allowed')
    expect(result.status.value).toBe('error')
    expect(result.error.value?.message).toContain('not allowed')
    expect(convex.calls.mutation).toHaveLength(0)
  })

  it('rejects oversized files before requesting an upload URL', async () => {
    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:generateUploadUrl:max-size')
    convex.setMutationHandler('files:generateUploadUrl:max-size', async () => 'http://upload.local')
    const { result } = await captureInNuxt(() => useConvexFileUpload(mutation, { maxSize: 4 }), {
      convex,
    })

    await expect(
      result.upload(new File(['hello'], 'hello.txt', { type: 'text/plain' })),
    ).rejects.toThrow('exceeds maximum')
    expect(result.status.value).toBe('error')
    expect(convex.calls.mutation).toHaveLength(0)
  })

  it('cancel() aborts in-flight upload and resets state', async () => {
    FakeXhr.delayMs = 50

    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:generateUploadUrl')
    convex.setMutationHandler('files:generateUploadUrl', async () => 'http://upload.local')

    const { result } = await captureInNuxt(() => useConvexFileUpload(mutation), { convex })
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })

    const uploadPromise = result.upload(file)
    await waitFor(() => result.progress.value.percent > 0, { timeoutMs: 1000 })
    result.cancel()

    await expect(uploadPromise).rejects.toThrow()
    expect(result.status.value).toBe('idle')
    expect(result.progress.value).toEqual({ loaded: 0, total: 0, percent: 0 })
    expect(result.data.value).toBeUndefined()
  })

  it('rejects a second concurrent upload() while one is pending', async () => {
    FakeXhr.delayMs = 20

    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:generateUploadUrl:concurrent')
    convex.setMutationHandler(
      'files:generateUploadUrl:concurrent',
      async () => 'http://upload.local',
    )

    const { result } = await captureInNuxt(() => useConvexFileUpload(mutation), { convex })
    const fileA = new File(['a'], 'a.txt', { type: 'text/plain' })
    const fileB = new File(['b'], 'b.txt', { type: 'text/plain' })

    // No `await` between these two calls: the first synchronously flips
    // status to 'pending' before yielding at its first `await`, so the
    // second call must see 'pending' and reject immediately — without
    // touching the first call's status/error state.
    const firstPromise = result.upload(fileA)
    expect(result.status.value).toBe('pending')

    await expect(result.upload(fileB)).rejects.toThrow('Upload already in progress')
    // The rejected concurrent call must not have clobbered the in-flight upload.
    expect(result.status.value).toBe('pending')

    const storageId = await firstPromise
    expect(storageId).toBe('storage_1')
    expect(result.status.value).toBe('success')
    expect(result.error.value).toBeUndefined()
  })

  it('cancel() during the URL-request phase prevents the XHR and leaves state idle', async () => {
    const sendSpy = vi.spyOn(FakeXhr.prototype, 'send')

    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:generateUploadUrl:cancel-during-url')
    const urlRequest = deferred<string>()
    convex.setMutationHandler('files:generateUploadUrl:cancel-during-url', async () => {
      return await urlRequest.promise
    })

    const { result } = await captureInNuxt(() => useConvexFileUpload(mutation), { convex })
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })

    const uploadPromise = result.upload(file)
    expect(result.status.value).toBe('pending')

    // Cancel while still waiting on the generateUploadUrl mutation — before
    // the previous behavior assigned an AbortController, this was a no-op.
    result.cancel()
    expect(result.status.value).toBe('idle')

    // Now let the mutation resolve; the upload must not proceed to the XHR.
    urlRequest.resolve('http://upload.local')

    await expect(uploadPromise).rejects.toThrow()
    expect(sendSpy).not.toHaveBeenCalled()
    expect(result.status.value).toBe('idle')
    expect(result.progress.value).toEqual({ loaded: 0, total: 0, percent: 0 })
    expect(result.data.value).toBeUndefined()
    expect(result.error.value).toBeUndefined()
  })

  it('rejects immediately on identity change while the upload URL request is still pending', async () => {
    const sendSpy = vi.spyOn(FakeXhr.prototype, 'send')

    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:generateUploadUrl:identity-during-url')
    const urlRequest = deferred<string>()
    convex.setMutationHandler('files:generateUploadUrl:identity-during-url', async () => {
      return await urlRequest.promise
    })
    let identity!: ReturnType<typeof installIdentityPortHarness>

    const { result } = await captureInNuxt(
      () => {
        identity = installIdentityPortHarness()
        return useConvexFileUpload(mutation)
      },
      { convex },
    )
    const uploadPromise = result.upload(new File(['a'], 'a.txt', { type: 'text/plain' }))
    expect(result.status.value).toBe('pending')

    identity.advance()

    await expect(uploadPromise).rejects.toMatchObject({
      kind: 'authentication',
      code: 'IDENTITY_CHANGED',
    })
    expect(result.status.value).toBe('idle')
    expect(result.data.value).toBeUndefined()
    expect(result.error.value).toBeUndefined()
    expect(sendSpy).not.toHaveBeenCalled()

    // A late URL result from A must remain inert after B became current.
    urlRequest.resolve('http://upload.local')
    await Promise.resolve()
    await Promise.resolve()
    expect(sendSpy).not.toHaveBeenCalled()
    expect(result.status.value).toBe('idle')
  })

  it.each([
    {
      boundary: 'success',
      watchedStatus: 'success' as const,
      response: { status: 200, responseText: JSON.stringify({ storageId: 'storage_1' }) },
    },
    {
      boundary: 'error',
      watchedStatus: 'error' as const,
      response: { status: 500, responseText: 'failed' },
    },
  ])(
    'retires before publishing $boundary state when a synchronous watcher changes identity',
    async ({ boundary, watchedStatus, response }) => {
      FakeXhr.next = response
      const convex = new MockConvexClient()
      const mutationName = `files:generateUploadUrl:identity-on-${boundary}`
      const mutation = mockFnRef<'mutation'>(mutationName)
      convex.setMutationHandler(mutationName, async () => 'http://upload.local')
      let identity!: ReturnType<typeof installIdentityPortHarness>

      const { result } = await captureInNuxt(
        () => {
          identity = installIdentityPortHarness()
          const upload = useConvexFileUpload(mutation)
          watch(
            upload.status,
            (status) => {
              if (status === watchedStatus) identity.advance()
            },
            { flush: 'sync' },
          )
          return upload
        },
        { convex },
      )

      await expect(
        result.upload(new File(['a'], 'a.txt', { type: 'text/plain' })),
      ).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
      expect(result.status.value).toBe('idle')
      expect(result.data.value).toBeUndefined()
      expect(result.error.value).toBeUndefined()
    },
  )

  it.each([
    {
      boundary: 'success',
      response: { status: 200, responseText: JSON.stringify({ storageId: 'storage_1' }) },
      assertOriginal: (promise: Promise<string>) => expect(promise).resolves.toBe('storage_1'),
    },
    {
      boundary: 'error',
      response: { status: 500, responseText: 'failed' },
      assertOriginal: (promise: Promise<string>) =>
        expect(promise).rejects.toThrow('Upload failed'),
    },
  ])(
    'lets completed $boundary work settle when a same-identity watcher starts fresh work',
    async ({ boundary, response, assertOriginal }) => {
      FakeXhr.next = response
      const convex = new MockConvexClient()
      const mutationName = `files:generateUploadUrl:same-identity-${boundary}`
      const mutation = mockFnRef<'mutation'>(mutationName)
      convex.setMutationHandler(mutationName, async () => 'http://upload.local')
      let freshUpload: Promise<string> | null = null

      const { result } = await captureInNuxt(
        () => {
          const upload = useConvexFileUpload(mutation, { allowedTypes: ['text/plain'] })
          watch(
            upload.status,
            (status) => {
              if (status !== boundary || freshUpload) return
              freshUpload = upload.upload(new File(['b'], 'b.pdf', { type: 'application/pdf' }))
              void freshUpload.catch(() => {})
            },
            { flush: 'sync' },
          )
          return upload
        },
        { convex },
      )

      const original = result.upload(new File(['a'], 'a.txt', { type: 'text/plain' }))
      await assertOriginal(original)
      if (!freshUpload) throw new Error('Expected the watcher to start fresh work')
      await expect(freshUpload).rejects.toThrow('not allowed')
      expect(result.status.value).toBe('error')
      expect(result.error.value?.message).toContain('not allowed')
    },
  )

  it('returns identity change when cancel publication crosses the boundary', async () => {
    FakeXhr.delayMs = 200
    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:generateUploadUrl:identity-on-cancel')
    convex.setMutationHandler(
      'files:generateUploadUrl:identity-on-cancel',
      async () => 'http://upload.local',
    )
    let identity!: ReturnType<typeof installIdentityPortHarness>

    const { result } = await captureInNuxt(
      () => {
        identity = installIdentityPortHarness()
        const upload = useConvexFileUpload(mutation)
        watch(
          upload.status,
          (status, previous) => {
            if (previous === 'pending' && status === 'idle') identity.advance()
          },
          { flush: 'sync' },
        )
        return upload
      },
      { convex },
    )

    const pending = result.upload(new File(['a'], 'a.txt', { type: 'text/plain' }))
    await waitFor(() => result.progress.value.percent > 0)
    result.cancel()

    await expect(pending).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
    expect(result.status.value).toBe('idle')
    expect(result.data.value).toBeUndefined()
    expect(result.error.value).toBeUndefined()
  })

  it('retires progress when a synchronous progress watcher changes identity', async () => {
    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:generateUploadUrl:identity-on-progress')
    convex.setMutationHandler(
      'files:generateUploadUrl:identity-on-progress',
      async () => 'http://upload.local',
    )
    let identity!: ReturnType<typeof installIdentityPortHarness>

    const { result } = await captureInNuxt(
      () => {
        identity = installIdentityPortHarness()
        const upload = useConvexFileUpload(mutation)
        watch(
          upload.progress,
          (progress) => {
            if (progress.percent > 0) identity.advance()
          },
          { flush: 'sync' },
        )
        return upload
      },
      { convex },
    )

    await expect(
      result.upload(new File(['a'], 'a.txt', { type: 'text/plain' })),
    ).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
    expect(result.status.value).toBe('idle')
    expect(result.progress.value).toEqual({ loaded: 0, total: 0, percent: 0 })
  })

  it('retires an active upload on identity change and permits fresh work', async () => {
    FakeXhr.delayMs = 50

    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:generateUploadUrl:identity-change')
    convex.setMutationHandler(
      'files:generateUploadUrl:identity-change',
      async () => 'http://upload.local',
    )
    let identity!: ReturnType<typeof installIdentityPortHarness>

    const { result } = await captureInNuxt(
      () => {
        identity = installIdentityPortHarness()
        return useConvexFileUpload(mutation)
      },
      { convex },
    )
    const first = result.upload(new File(['a'], 'a.txt', { type: 'text/plain' }))
    await waitFor(() => result.pending.value && result.progress.value.percent > 0)
    identity.advance()

    expect(result.status.value).toBe('idle')
    expect(result.data.value).toBeUndefined()
    expect(result.error.value).toBeUndefined()
    expect(result.progress.value).toEqual({ loaded: 0, total: 0, percent: 0 })
    await expect(first).rejects.toMatchObject({
      kind: 'authentication',
      code: 'IDENTITY_CHANGED',
    })
    FakeXhr.delayMs = 0
    await expect(result.upload(new File(['b'], 'b.txt', { type: 'text/plain' }))).resolves.toBe(
      'storage_1',
    )
    expect(result.status.value).toBe('success')
    expect(result.data.value).toBe('storage_1')

    // The old fake XHR still attempts its delayed load. It must not overwrite B.
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(result.status.value).toBe('success')
    expect(result.data.value).toBe('storage_1')

    // Finished state is identity-owned too; a later transition masks B's result.
    identity.advance()
    expect(result.status.value).toBe('idle')
    expect(result.data.value).toBeUndefined()
    expect(result.error.value).toBeUndefined()
    expect(result.progress.value).toEqual({ loaded: 0, total: 0, percent: 0 })
  })

  it('does not let A retirement clobber re-entrant B validation state', async () => {
    FakeXhr.delayMs = 200
    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:generateUploadUrl:reentrant-retirement')
    convex.setMutationHandler(
      'files:generateUploadUrl:reentrant-retirement',
      async () => 'http://upload.local',
    )
    let identity!: ReturnType<typeof installIdentityPortHarness>
    let launchFresh = false
    let freshUpload: Promise<string> | null = null

    const { result } = await captureInNuxt(
      () => {
        identity = installIdentityPortHarness()
        const upload = useConvexFileUpload(mutation, { allowedTypes: ['text/plain'] })
        watch(
          upload.status,
          (status, previous) => {
            if (launchFresh && previous === 'pending' && status === 'idle') {
              launchFresh = false
              freshUpload = upload.upload(new File(['b'], 'b.pdf', { type: 'application/pdf' }))
              void freshUpload.catch(() => {})
            }
          },
          { flush: 'sync' },
        )
        return upload
      },
      { convex },
    )

    const retired = result.upload(new File(['a'], 'a.txt', { type: 'text/plain' }))
    await waitFor(() => result.progress.value.percent > 0)
    launchFresh = true
    identity.advance()

    await expect(retired).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
    if (!freshUpload) throw new Error('Expected B upload to start during A retirement')
    await expect(freshUpload).rejects.toThrow('not allowed')
    expect(result.status.value).toBe('error')
    expect(result.error.value?.message).toContain('not allowed')
  })
})
