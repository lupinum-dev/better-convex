import type { FunctionReference } from 'convex/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useConvexFileUpload } from '../../src/runtime/composables/useConvexFileUpload'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt, installIdentityPortHarness } from '../helpers/nuxt-runtime-harness'

class FakeXhr {
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null }
  status = 0
  statusText = ''
  responseText = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null

  open() {}
  setRequestHeader() {}

  send() {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent)
    setTimeout(() => {
      this.status = 200
      this.responseText = JSON.stringify({ storageId: 'storage_1' })
      this.onload?.()
    }, 0)
  }

  abort() {
    this.onabort?.()
  }
}

const originalXhr = globalThis.XMLHttpRequest

beforeEach(() => {
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest
})

afterAll(() => {
  globalThis.XMLHttpRequest = originalXhr
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// The lifecycle itself is covered framework-free in test/unit/vue-file-upload.test.ts
// and test/unit/vue-file-upload-workflow.test.ts. These cases prove the Nuxt facade
// forwards its options and drives the lifecycle through the Nuxt runtime's client
// and identity.
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

    const uploaded = await result.upload(file)

    expect(uploaded).toEqual({
      storageId: 'storage_1',
      prepared: 'http://upload.local',
      completed: undefined,
    })
    expect(result.progress.value).toEqual({ loaded: 5, total: 10, percent: 50 })
    expect(result.status.value).toBe('success')
    expect(result.data.value).toBe(uploaded)
    expect(result.error.value).toBeUndefined()
  })

  it('hands the per-call context to url and complete through the Nuxt facade', async () => {
    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('files:generateUploadUrl:context')
    const attach = mockFnRef<'mutation'>('assets:attach') as FunctionReference<
      'mutation',
      'public',
      { assetId: string; storageId: string },
      null
    >
    convex.setMutationHandler('files:generateUploadUrl:context', async () => 'http://upload.local')
    convex.setMutationHandler('assets:attach', async () => null)
    const urlContexts: unknown[] = []

    const { result } = await captureInNuxt(
      () =>
        useConvexFileUpload(mutation, {
          url: (prepared: string, { context }: { file: File; context: { assetId: string } }) => {
            urlContexts.push(context)
            return prepared
          },
          complete: (op, { storageId, context }) =>
            op.mutation(attach, { assetId: context.assetId, storageId }),
        }),
      { convex },
    )
    const selected = { assetId: 'asset_a' }
    const uploading = result.upload(
      new File(['hello'], 'hello.txt', { type: 'text/plain' }),
      {},
      { context: selected },
    )
    selected.assetId = 'asset_b'
    await uploading

    expect(urlContexts).toEqual([{ assetId: 'asset_a' }])
    expect(convex.calls.mutation.at(-1)?.args).toEqual({
      assetId: 'asset_a',
      storageId: 'storage_1',
    })
  })

  it.each([
    ['FILE_TYPE_NOT_ALLOWED', { allowedTypes: ['image/*'] }],
    ['FILE_TOO_LARGE', { maxSize: 4 }],
  ] as const)(
    'forwards the %s preflight before requesting an upload URL',
    async (code, options) => {
      const convex = new MockConvexClient()
      const mutation = mockFnRef<'mutation'>('files:generateUploadUrl')
      convex.setMutationHandler('files:generateUploadUrl', async () => 'http://upload.local')
      const { result } = await captureInNuxt(() => useConvexFileUpload(mutation, options), {
        convex,
      })

      await expect(
        result.upload(new File(['hello'], 'hello.txt', { type: 'text/plain' })),
      ).rejects.toMatchObject({ code, functionName: 'files:generateUploadUrl' })
      expect(result.status.value).toBe('error')
      expect(convex.calls.mutation).toHaveLength(0)
    },
  )

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
})
