import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, watch } from 'vue'

import { useConvexFileUpload, type UseConvexFileUploadOptions } from '../../packages/vue/src'
import { ConvexCallError } from '../../packages/vue/src/errors'
import { useConvexFileUploadInternal } from '../../packages/vue/src/use-file-upload'
import { attachedVueHost } from '../helpers/attached-vue-host'

class FakeXhr {
  static next = { status: 200, responseText: JSON.stringify({ storageId: 'storage_1' }) }
  static delayMs = 0
  static sent: FakeXhr[] = []
  static urls: string[] = []

  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null }
  status = 0
  statusText = ''
  responseText = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null

  open(_method: string, url: string) {
    FakeXhr.urls.push(url)
  }
  setRequestHeader() {}

  send() {
    FakeXhr.sent.push(this)
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent)
    setTimeout(() => {
      this.status = FakeXhr.next.status
      this.statusText = FakeXhr.next.status === 200 ? 'OK' : 'Server Error'
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
  FakeXhr.next = { status: 200, responseText: JSON.stringify({ storageId: 'storage_1' }) }
  FakeXhr.delayMs = 0
  FakeXhr.sent = []
  FakeXhr.urls = []
})

afterAll(() => {
  globalThis.XMLHttpRequest = originalXhr
})

const uploadUrl = makeFunctionReference<'mutation'>('files:generateUploadUrl') as FunctionReference<
  'mutation',
  'public',
  Record<string, never>,
  string
>

const textFile = (name = 'a.txt', body = 'hello') => new File([body], name, { type: 'text/plain' })

function uploadHost(options?: { mutation?: (args: unknown) => Promise<unknown> }) {
  const mutation = vi.fn(async (_reference: unknown, args: unknown) =>
    options?.mutation ? options.mutation(args) : 'https://upload.test/url?token=secret-token',
  )
  const host = attachedVueHost({ mutation })
  return {
    ...host,
    mutation,
    use: (uploadOptions?: UseConvexFileUploadOptions) =>
      host.run(() => useConvexFileUpload(uploadUrl, uploadOptions)),
  }
}

describe('useConvexFileUpload (Vue)', () => {
  it('uploads a file, publishes byte progress, and returns the storage ID', async () => {
    const host = uploadHost()
    const upload = host.use()
    const progress: number[] = []
    host.run(() => watch(upload.progress, (value) => progress.push(value.percent)))

    expect(upload.status.value).toBe('idle')
    const pending = upload.upload(textFile())
    expect(upload.status.value).toBe('pending')
    expect(upload.pending.value).toBe(true)

    const result = await pending
    expect(result).toEqual({
      storageId: 'storage_1',
      prepared: 'https://upload.test/url?token=secret-token',
      completed: undefined,
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(upload.status.value).toBe('success')
    expect(upload.data.value).toBe(result)
    expect(upload.error.value).toBeUndefined()
    expect(upload.progress.value).toEqual({ loaded: 5, total: 10, percent: 50 })
    expect(progress).toContain(50)
    expect(FakeXhr.urls).toEqual(['https://upload.test/url?token=secret-token'])
    host.stop()
  })

  it('forwards validator-derived mutation args', async () => {
    const host = uploadHost()
    const reference = makeFunctionReference<'mutation'>(
      'files:workspaceUploadUrl',
    ) as FunctionReference<'mutation', 'public', { workspaceId: string }, string>
    const upload = host.run(() => useConvexFileUpload(reference))

    await upload.upload(textFile(), { args: { workspaceId: 'workspace_1' } })
    expect(host.mutation.mock.calls[0]?.[1]).toEqual({ workspaceId: 'workspace_1' })
    host.stop()
  })

  it.each([
    ['FILE_TOO_LARGE', { maxSize: 4 }, 'exceeds maximum'],
    ['FILE_TYPE_NOT_ALLOWED', { allowedTypes: ['image/*'] }, 'not allowed'],
  ] as const)('rejects %s before making any request', async (code, options, message) => {
    const host = uploadHost()
    const upload = host.use(options)

    const failure = upload.upload(textFile())
    await expect(failure).rejects.toBeInstanceOf(ConvexCallError)
    await expect(failure).rejects.toMatchObject({
      code,
      kind: 'unknown',
      functionName: 'files:generateUploadUrl',
      outcome: 'not-sent',
      phase: undefined,
    })
    await expect(failure).rejects.toThrow(message)
    expect(upload.status.value).toBe('error')
    expect(upload.error.value?.code).toBe(code)
    expect(host.mutation).not.toHaveBeenCalled()
    expect(FakeXhr.sent).toHaveLength(0)
    host.stop()
  })

  it('rejects a concurrent upload with UPLOAD_IN_PROGRESS without touching the first', async () => {
    FakeXhr.delayMs = 10
    const host = uploadHost()
    const upload = host.use()

    const first = upload.upload(textFile('a.txt'))
    expect(upload.status.value).toBe('pending')
    await expect(upload.upload(textFile('b.txt'))).rejects.toMatchObject({
      code: 'UPLOAD_IN_PROGRESS',
      functionName: 'files:generateUploadUrl',
    })
    expect(upload.status.value).toBe('pending')
    expect(upload.error.value).toBeUndefined()

    await expect(first).resolves.toMatchObject({ storageId: 'storage_1' })
    expect(upload.status.value).toBe('success')
    host.stop()
  })

  it('cancel() rejects the in-flight upload with CANCELLED and returns to idle', async () => {
    FakeXhr.delayMs = 200
    const host = uploadHost()
    const upload = host.use()

    const pending = upload.upload(textFile())
    await vi.waitFor(() => expect(upload.progress.value.percent).toBe(50), { interval: 1 })
    upload.cancel()

    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED', kind: 'unknown' })
    expect(upload.status.value).toBe('idle')
    expect(upload.error.value).toBeUndefined()
    expect(upload.data.value).toBeUndefined()
    expect(upload.progress.value).toEqual({ loaded: 0, total: 0, percent: 0 })
    host.stop()
  })

  it('cancel() keeps a finished result; reset() clears it', async () => {
    const host = uploadHost()
    const upload = host.use({ maxSize: 100 })

    await upload.upload(textFile())
    upload.cancel()
    expect(upload.status.value).toBe('success')
    expect(upload.data.value?.storageId).toBe('storage_1')

    upload.reset()
    expect(upload.status.value).toBe('idle')
    expect(upload.data.value).toBeUndefined()
    expect(upload.progress.value).toEqual({ loaded: 0, total: 0, percent: 0 })

    await expect(upload.upload(textFile('big.txt', 'x'.repeat(101)))).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    })
    upload.reset()
    expect(upload.status.value).toBe('idle')
    expect(upload.error.value).toBeUndefined()
    host.stop()
  })

  it('reset() and scope disposal reject the in-flight upload with CANCELLED', async () => {
    FakeXhr.delayMs = 50
    const host = uploadHost()
    const runtimeListeners = host.listeners.size
    const upload = host.use()
    expect(host.listeners.size).toBe(runtimeListeners + 1)

    const reset = upload.upload(textFile())
    upload.reset()
    await expect(reset).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(upload.status.value).toBe('idle')

    const disposed = upload.upload(textFile())
    host.stop()
    await expect(disposed).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(upload.status.value).toBe('idle')
    await expect(upload.upload(textFile())).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(host.listeners.size).toBe(runtimeListeners)
  })

  it('retires in-flight and finished state when the identity changes', async () => {
    FakeXhr.delayMs = 200
    const host = uploadHost()
    const upload = host.use()

    const first = upload.upload(textFile())
    await vi.waitFor(() => expect(upload.progress.value.percent).toBe(50), { interval: 1 })
    host.advanceIdentity()
    expect(upload.status.value).toBe('idle')
    expect(upload.progress.value).toEqual({ loaded: 0, total: 0, percent: 0 })
    await expect(first).rejects.toMatchObject({
      kind: 'authentication',
      code: 'IDENTITY_CHANGED',
      functionName: 'files:generateUploadUrl',
    })

    FakeXhr.delayMs = 0
    await expect(upload.upload(textFile())).resolves.toMatchObject({ storageId: 'storage_1' })
    expect(upload.status.value).toBe('success')

    // A late load from the retired request must not overwrite the new identity's result.
    const stale = FakeXhr.sent[0]!
    stale.status = 200
    stale.responseText = JSON.stringify({ storageId: 'storage_stale' })
    stale.onload?.()
    expect(upload.status.value).toBe('success')
    expect(upload.data.value?.storageId).toBe('storage_1')

    // Finished state is identity-owned too.
    host.advanceIdentity()
    expect(upload.status.value).toBe('idle')
    expect(upload.data.value).toBeUndefined()
    expect(upload.error.value).toBeUndefined()
    expect(upload.progress.value).toEqual({ loaded: 0, total: 0, percent: 0 })
    host.stop()
  })

  it.each([
    ['success', { status: 200, responseText: JSON.stringify({ storageId: 'storage_1' }) }],
    ['error', { status: 500, responseText: 'failed' }],
  ] as const)(
    'retires before publishing %s state when a synchronous watcher changes identity',
    async (boundary, response) => {
      FakeXhr.next = response
      const host = uploadHost()
      const upload = host.use()
      host.run(() =>
        watch(
          upload.status,
          (status) => {
            if (status === boundary) host.advanceIdentity()
          },
          { flush: 'sync' },
        ),
      )

      await expect(upload.upload(textFile())).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
      expect(upload.status.value).toBe('idle')
      expect(upload.data.value).toBeUndefined()
      expect(upload.error.value).toBeUndefined()
      host.stop()
    },
  )

  it('retires progress when a synchronous progress watcher changes identity', async () => {
    const host = uploadHost()
    const upload = host.use()
    host.run(() =>
      watch(
        upload.progress,
        (progress) => {
          if (progress.percent > 0) host.advanceIdentity()
        },
        { flush: 'sync' },
      ),
    )

    await expect(upload.upload(textFile())).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
    expect(upload.status.value).toBe('idle')
    expect(upload.progress.value).toEqual({ loaded: 0, total: 0, percent: 0 })
    host.stop()
  })

  it('reports an identity change that the cancel publication causes', async () => {
    FakeXhr.delayMs = 200
    const host = uploadHost()
    const upload = host.use()
    host.run(() =>
      watch(
        upload.status,
        (status, previous) => {
          if (previous === 'pending' && status === 'idle') host.advanceIdentity()
        },
        { flush: 'sync' },
      ),
    )

    const pending = upload.upload(textFile())
    await vi.waitFor(() => expect(upload.progress.value.percent).toBe(50), { interval: 1 })
    upload.cancel()

    await expect(pending).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
    expect(upload.status.value).toBe('idle')
    expect(upload.data.value).toBeUndefined()
    expect(upload.error.value).toBeUndefined()
    host.stop()
  })

  it.each([
    ['success', { status: 200, responseText: JSON.stringify({ storageId: 'storage_1' }) }],
    ['error', { status: 500, responseText: 'failed' }],
  ] as const)(
    'lets finished %s work settle when a same-identity watcher starts fresh work',
    async (boundary, response) => {
      FakeXhr.next = response
      const host = uploadHost()
      const upload = host.use({ allowedTypes: ['text/plain'] })
      let fresh: Promise<unknown> | undefined
      host.run(() =>
        watch(
          upload.status,
          (status) => {
            if (status !== boundary || fresh) return
            fresh = upload.upload(new File(['b'], 'b.pdf', { type: 'application/pdf' }))
            void fresh.catch(() => {})
          },
          { flush: 'sync' },
        ),
      )

      const original = upload.upload(textFile())
      if (boundary === 'success') {
        await expect(original).resolves.toMatchObject({ storageId: 'storage_1' })
      } else {
        await expect(original).rejects.toThrow('Upload failed')
      }
      await expect(fresh).rejects.toThrow('not allowed')
      expect(upload.status.value).toBe('error')
      expect(upload.error.value?.code).toBe('FILE_TYPE_NOT_ALLOWED')
      host.stop()
    },
  )

  it('does not let a retirement clobber state that its idle watcher started', async () => {
    FakeXhr.delayMs = 200
    const host = uploadHost()
    const upload = host.use({ allowedTypes: ['text/plain'] })
    let launchFresh = false
    let fresh: Promise<unknown> | undefined
    host.run(() =>
      watch(
        upload.status,
        (status, previous) => {
          if (!launchFresh || previous !== 'pending' || status !== 'idle') return
          launchFresh = false
          fresh = upload.upload(new File(['b'], 'b.pdf', { type: 'application/pdf' }))
          void fresh.catch(() => {})
        },
        { flush: 'sync' },
      ),
    )

    const retired = upload.upload(textFile())
    await vi.waitFor(() => expect(upload.progress.value.percent).toBe(50), { interval: 1 })
    launchFresh = true
    host.advanceIdentity()

    await expect(retired).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
    await expect(fresh).rejects.toThrow('not allowed')
    expect(upload.status.value).toBe('error')
    expect(upload.error.value?.code).toBe('FILE_TYPE_NOT_ALLOWED')
    host.stop()
  })

  it('normalizes mutation and transport failures with the function name', async () => {
    const host = uploadHost({ mutation: async () => 42 })
    const upload = host.use()
    await expect(upload.upload(textFile())).rejects.toMatchObject({
      code: 'INVALID_UPLOAD_URL',
      message: 'generateUploadUrl mutation must return a string URL',
      functionName: 'files:generateUploadUrl',
    })
    expect(FakeXhr.sent).toHaveLength(0)
    host.stop()

    FakeXhr.next = { status: 500, responseText: 'secret upstream body' }
    const failing = uploadHost()
    const failingUpload = failing.use()
    const failure = failingUpload.upload(textFile())
    await expect(failure).rejects.toMatchObject({
      kind: 'transport',
      code: 'UPSTREAM_ERROR',
      status: 500,
      functionName: 'files:generateUploadUrl',
    })
    const error = await failure.catch((cause: ConvexCallError) => cause)
    expect(JSON.stringify(error)).not.toContain('secret-token')
    expect(JSON.stringify(error)).not.toContain('secret upstream body')
    expect(failingUpload.status.value).toBe('error')
    failing.stop()
  })

  it.each([
    ['missing', JSON.stringify({})],
    ['empty', JSON.stringify({ storageId: '' })],
    ['wrong type', JSON.stringify({ storageId: 42 })],
    ['invalid JSON', '{'],
  ])('rejects a %s storage ID response as a transport error', async (_label, responseText) => {
    FakeXhr.next = { status: 200, responseText }
    const host = uploadHost()
    const upload = host.use()

    await expect(upload.upload(textFile())).rejects.toMatchObject({
      kind: 'transport',
      code: 'INVALID_RESPONSE',
    })
    expect(upload.data.value).toBeUndefined()
    expect(upload.status.value).toBe('error')
    host.stop()
  })

  it('rejects with CLIENT_UNAVAILABLE without a browser runtime', async () => {
    const scope = effectScope()
    const upload = scope.run(() => useConvexFileUpload(uploadUrl))!

    await expect(upload.upload(textFile())).rejects.toMatchObject({
      code: 'CLIENT_UNAVAILABLE',
      functionName: 'files:generateUploadUrl',
    })
    expect(upload.status.value).toBe('error')
    expect(FakeXhr.sent).toHaveLength(0)
    scope.stop()
  })

  it('rejects with CLIENT_UNAVAILABLE where XHR does not exist, before any request', async () => {
    const host = uploadHost()
    const upload = host.use()
    // A server has no XHR: no upload URL may be minted there.
    globalThis.XMLHttpRequest = undefined as unknown as typeof XMLHttpRequest

    await expect(upload.upload(textFile())).rejects.toMatchObject({ code: 'CLIENT_UNAVAILABLE' })
    expect(host.mutation).not.toHaveBeenCalled()
    host.stop()
  })

  it('requires an effect scope and exposes only the documented state', () => {
    expect(() => useConvexFileUpload(uploadUrl)).toThrow('must run inside a Vue effect scope')
    const host = uploadHost()
    const upload = host.use()
    expect(Object.keys(upload).sort()).toEqual([
      'cancel',
      'data',
      'error',
      'pending',
      'progress',
      'reset',
      'status',
      'upload',
    ])
    host.stop()
  })

  it('reports settled outcomes to the adapter observer, never cancellations', async () => {
    FakeXhr.delayMs = 20
    const host = uploadHost()
    const observer = { succeeded: vi.fn(), failed: vi.fn() }
    const upload = host.run(() =>
      useConvexFileUploadInternal(uploadUrl, { maxSize: 100, observer }),
    )

    await upload.upload(textFile())
    expect(observer.succeeded).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: expect.any(Number) }),
    )
    await expect(upload.upload(textFile('big.txt', 'x'.repeat(101)))).rejects.toThrow()
    expect(observer.failed).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'FILE_TOO_LARGE' }) }),
    )

    observer.failed.mockClear()
    const cancelled = upload.upload(textFile())
    upload.cancel()
    await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(observer.failed).not.toHaveBeenCalled()

    observer.succeeded.mockImplementation(() => {
      throw new Error('diagnostics failed')
    })
    FakeXhr.delayMs = 0
    await expect(upload.upload(textFile())).resolves.toMatchObject({ storageId: 'storage_1' })
    host.stop()
  })
})
