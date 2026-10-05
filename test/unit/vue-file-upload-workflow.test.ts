import { getFunctionName, makeFunctionReference, type FunctionReference } from 'convex/server'
import { ConvexError } from 'convex/values'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'

import { useConvexFileUpload, type UploadCompleteContext } from '../../packages/vue/src'
import type { ConvexCallError } from '../../packages/vue/src/errors'
import { createFileUploadController } from '../../packages/vue/src/internal/upload-controller'
import { useOperationController } from '../../packages/vue/src/use-operation'
import { attachedVueHost } from '../helpers/attached-vue-host'

/** A storage endpoint whose answer each test releases explicitly. */
class FakeXhr {
  static sent: FakeXhr[] = []
  static aborted = 0

  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null }
  status = 0
  statusText = ''
  responseText = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  url = ''

  open(_method: string, url: string) {
    this.url = url
  }
  setRequestHeader() {}
  send() {
    FakeXhr.sent.push(this)
  }
  abort() {
    FakeXhr.aborted += 1
    this.onabort?.()
  }
  respond(storageId = 'storage_1', status = 200) {
    this.status = status
    this.statusText = status === 200 ? 'OK' : 'Server Error'
    this.responseText = JSON.stringify({ storageId })
    this.onload?.()
  }
  failNetwork() {
    this.onerror?.()
  }
}

const originalXhr = globalThis.XMLHttpRequest

beforeEach(() => {
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest
  FakeXhr.sent = []
  FakeXhr.aborted = 0
})

afterAll(() => {
  globalThis.XMLHttpRequest = originalXhr
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

type Session = { uploadUrl: string; sessionId: string; token: string }

const createSession = makeFunctionReference<'mutation'>('files:createSession') as FunctionReference<
  'mutation',
  'public',
  { folder: string },
  Session
>
const claimUpload = makeFunctionReference<'mutation'>('files:claim') as FunctionReference<
  'mutation',
  'public',
  { sessionId: string; token: string; storageId: string },
  { fileId: string }
>
const attachEvidence = makeFunctionReference<'action'>('evidence:attach') as FunctionReference<
  'action',
  'public',
  { storageId: string; originalName: string },
  string
>
const uploadUrl = makeFunctionReference<'mutation'>('files:generateUploadUrl') as FunctionReference<
  'mutation',
  'public',
  Record<string, never>,
  string
>

const SESSION: Session = {
  uploadUrl: 'https://upload.test/session?token=secret',
  sessionId: 'session_1',
  token: 'claim-token',
}

const textFile = () => new File(['hello'], 'evidence.pdf', { type: 'application/pdf' })

type Handler = (args: unknown) => unknown

/** One Vue app over an attached client whose answers are keyed by function name. */
function workflowHost(handlers: Record<string, Handler>) {
  const answer = (reference: unknown, args: unknown) => {
    const handler = handlers[getFunctionName(reference as FunctionReference<'mutation'>)]
    if (!handler) throw new Error('unexpected call')
    return Promise.resolve(handler(args))
  }
  const mutation = vi.fn(answer)
  const action = vi.fn(answer)
  return {
    ...attachedVueHost({ mutation, action }),
    mutation,
    calls: (name: string) =>
      [...mutation.mock.calls, ...action.mock.calls].filter(
        ([reference]) => getFunctionName(reference as FunctionReference<'mutation'>) === name,
      ),
  }
}

/** The ginko-style workflow: session object, selected URL, claim mutation. */
function sessionUpload(
  host: ReturnType<typeof workflowHost>,
  hooks: { url?: () => void; complete?: () => void } = {},
) {
  return host.run(() =>
    useConvexFileUpload(createSession, {
      url: (session) => {
        hooks.url?.()
        return session.uploadUrl
      },
      complete: (op, { prepared, storageId }) => {
        hooks.complete?.()
        return op.mutation(claimUpload, {
          sessionId: prepared.sessionId,
          token: prepared.token,
          storageId,
        })
      },
    }),
  )
}

async function nextXhr(): Promise<FakeXhr> {
  await vi.waitFor(() => expect(FakeXhr.sent.length).toBeGreaterThan(0), { interval: 1 })
  return FakeXhr.sent.at(-1)!
}

describe('useConvexFileUpload workflows', () => {
  it('prepares an object, uploads to the selected URL, and completes in one pending lifecycle', async () => {
    const claim = deferred<{ fileId: string }>()
    const host = workflowHost({
      'files:createSession': () => SESSION,
      'files:claim': () => claim.promise,
    })
    const upload = sessionUpload(host)

    const pending = upload.upload(textFile(), { args: { folder: 'evidence' } })
    ;(await nextXhr()).respond('storage_7')
    await vi.waitFor(() => expect(host.calls('files:claim')).toHaveLength(1))
    // The completion is part of the same lifecycle.
    expect(upload.pending.value).toBe(true)
    expect(upload.data.value).toBeUndefined()

    claim.resolve({ fileId: 'file_7' })
    const result = await pending
    expect(result).toEqual({
      storageId: 'storage_7',
      prepared: SESSION,
      completed: { fileId: 'file_7' },
    })
    expect(upload.status.value).toBe('success')
    expect(upload.data.value).toBe(result)
    expect(FakeXhr.sent[0]?.url).toBe(SESSION.uploadUrl)
    expect(host.calls('files:createSession')[0]?.[1]).toEqual({ folder: 'evidence' })
    expect(host.calls('files:claim')[0]?.[1]).toEqual({
      sessionId: 'session_1',
      token: 'claim-token',
      storageId: 'storage_7',
    })
    host.stop()
  })

  it('runs a multi-step completion as steps of the same operation', async () => {
    const host = workflowHost({
      'files:createSession': () => SESSION,
      'files:claim': () => ({ fileId: 'file_3' }),
      'evidence:attach': () => 'evidence_3',
    })
    const upload = host.run(() =>
      useConvexFileUpload(createSession, {
        url: (session) => session.uploadUrl,
        complete: async (op, { prepared, storageId, file }) => {
          const claimed = await op.mutation(claimUpload, {
            sessionId: prepared.sessionId,
            token: prepared.token,
            storageId,
          })
          const evidence = await op.action(attachEvidence, { storageId, originalName: file.name })
          return { ...claimed, evidence }
        },
      }),
    )

    const pending = upload.upload(textFile(), { args: { folder: 'x' } })
    ;(await nextXhr()).respond('storage_3')

    await expect(pending).resolves.toMatchObject({
      completed: { fileId: 'file_3', evidence: 'evidence_3' },
    })
    expect(upload.pending.value).toBe(false)
    expect(host.calls('evidence:attach')[0]?.[1]).toEqual({
      storageId: 'storage_3',
      originalName: 'evidence.pdf',
    })
    host.stop()
  })

  it('never sends a later completion step once the identity changed', async () => {
    const claim = deferred<{ fileId: string }>()
    const host = workflowHost({
      'files:createSession': () => SESSION,
      'files:claim': () => claim.promise,
      'evidence:attach': () => 'never',
    })
    const upload = host.run(() =>
      useConvexFileUpload(createSession, {
        url: (session) => session.uploadUrl,
        complete: async (op, { prepared, storageId }) => {
          await op
            .mutation(claimUpload, {
              sessionId: prepared.sessionId,
              token: prepared.token,
              storageId,
            })
            // The application ignores the first step's failure; the operation still stops.
            .catch(() => undefined)
          return op.action(attachEvidence, { storageId, originalName: 'x' })
        },
      }),
    )

    const pending = upload.upload(textFile(), { args: { folder: 'x' } })
    ;(await nextXhr()).respond()
    await vi.waitFor(() => expect(host.calls('files:claim')).toHaveLength(1))
    host.advanceIdentity()
    claim.resolve({ fileId: 'file_1' })

    // The claim was sent, so the completion phase as a whole may have committed.
    await expect(pending).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
      phase: 'complete',
      outcome: 'unknown',
      functionName: 'evidence:attach',
    })
    expect(host.calls('evidence:attach')).toHaveLength(0)
    expect(upload.status.value).toBe('idle')
    expect(upload.data.value).toBeUndefined()
    host.stop()
  })

  describe('the complete outcome covers every completion step', () => {
    /** Claim, then an identity change or cancel, then an attach that is never sent. */
    function twoStepUpload(host: ReturnType<typeof workflowHost>, between: () => void) {
      return host.run(() =>
        useConvexFileUpload(createSession, {
          url: (session) => session.uploadUrl,
          complete: async (op, { prepared, storageId }) => {
            await op.mutation(claimUpload, {
              sessionId: prepared.sessionId,
              token: prepared.token,
              storageId,
            })
            between()
            return op.action(attachEvidence, { storageId, originalName: 'x' })
          },
        }),
      )
    }

    it('reports unknown when a committed step precedes an identity change', async () => {
      const host = workflowHost({
        'files:createSession': () => SESSION,
        'files:claim': () => ({ fileId: 'file_1' }),
        'evidence:attach': () => 'never',
      })
      const upload = twoStepUpload(host, () => host.advanceIdentity())

      const pending = upload.upload(textFile(), { args: { folder: 'x' } })
      ;(await nextXhr()).respond()

      await expect(pending).rejects.toMatchObject({
        code: 'IDENTITY_CHANGED',
        phase: 'complete',
        outcome: 'unknown',
        functionName: 'evidence:attach',
      })
      expect(host.calls('files:claim')).toHaveLength(1)
      expect(host.calls('evidence:attach')).toHaveLength(0)
      expect(upload.status.value).toBe('idle')
      host.stop()
    })

    it('reports unknown when a committed step precedes cancel()', async () => {
      const host = workflowHost({
        'files:createSession': () => SESSION,
        'files:claim': () => ({ fileId: 'file_1' }),
        'evidence:attach': () => 'never',
      })
      const upload: ReturnType<typeof twoStepUpload> = twoStepUpload(host, () => upload.cancel())

      const pending = upload.upload(textFile(), { args: { folder: 'x' } })
      ;(await nextXhr()).respond()

      await expect(pending).rejects.toMatchObject({
        code: 'CANCELLED',
        phase: 'complete',
        outcome: 'unknown',
      })
      expect(host.calls('evidence:attach')).toHaveLength(0)
      expect(upload.status.value).toBe('idle')
      host.stop()
    })

    it.each([
      { label: 'before any completion step', sendFirst: false, outcome: 'not-sent' },
      { label: 'after a completion step', sendFirst: true, outcome: 'unknown' },
    ])(
      'records an outcome for a rethrown op.signal.reason $label',
      async ({ sendFirst, outcome }) => {
        const host = workflowHost({
          'files:createSession': () => SESSION,
          'files:claim': () => ({ fileId: 'file_1' }),
        })
        const upload = host.run(() =>
          useConvexFileUpload(createSession, {
            url: (session) => session.uploadUrl,
            complete: async (op, { prepared, storageId }) => {
              if (sendFirst) {
                await op.mutation(claimUpload, {
                  sessionId: prepared.sessionId,
                  token: prepared.token,
                  storageId,
                })
              }
              // Application work bound to the operation, such as `fetch`.
              await new Promise((_resolve, reject) => {
                op.signal.addEventListener('abort', () => reject(op.signal.reason), { once: true })
                host.advanceIdentity()
              })
            },
          }),
        )

        const pending = upload.upload(textFile(), { args: { folder: 'x' } })
        ;(await nextXhr()).respond()

        await expect(pending).rejects.toMatchObject({
          code: 'IDENTITY_CHANGED',
          phase: 'complete',
          outcome,
        })
        expect(upload.status.value).toBe('idle')
        host.stop()
      },
    )
  })

  it('stops holding a finished upload: a later identity change does not abort its signal', async () => {
    const host = workflowHost({
      'files:createSession': () => SESSION,
      'files:claim': () => ({ fileId: 'file_1' }),
    })
    const signals: AbortSignal[] = []
    const upload = host.run(() =>
      useConvexFileUpload(createSession, {
        url: (session) => session.uploadUrl,
        complete: (op, { prepared, storageId }) => {
          signals.push(op.signal)
          return op.mutation(claimUpload, {
            sessionId: prepared.sessionId,
            token: prepared.token,
            storageId,
          })
        },
      }),
    )

    for (let index = 0; index < 3; index += 1) {
      const pending = upload.upload(textFile(), { args: { folder: 'x' } })
      await vi.waitFor(() => expect(FakeXhr.sent).toHaveLength(index + 1), { interval: 1 })
      FakeXhr.sent[index]!.respond(`storage_${index}`)
      await pending
    }
    host.advanceIdentity()
    expect(signals).toHaveLength(3)
    expect(signals.filter((signal) => signal.aborted)).toEqual([])
    host.stop()
  })

  it('does not attribute a completion code failure to the upload-URL mutation', async () => {
    const host = workflowHost({ 'files:createSession': () => SESSION })
    const upload = host.run(() =>
      useConvexFileUpload(createSession, {
        url: (session) => session.uploadUrl,
        complete: async () => {
          throw new Error('application rule failed')
        },
      }),
    )

    const pending = upload.upload(textFile(), { args: { folder: 'x' } })
    ;(await nextXhr()).respond()
    const error = (await pending.catch((cause: unknown) => cause)) as ConvexCallError
    expect(error).toMatchObject({ phase: 'complete', kind: 'unknown' })
    expect(error.functionName).toBeUndefined()
    expect(upload.status.value).toBe('error')
    host.stop()
  })

  it('rejects an object result without a url option before any storage POST', async () => {
    const host = workflowHost({ 'files:createSession': () => SESSION })
    const upload = host.run(() =>
      // A non-string result requires `url`; a JavaScript caller can still omit it.
      (useConvexFileUpload as (...args: unknown[]) => ReturnType<typeof useConvexFileUpload>)(
        createSession,
      ),
    )

    await expect(
      upload.upload(textFile(), { args: { folder: 'x' } } as never),
    ).rejects.toMatchObject({
      code: 'INVALID_UPLOAD_URL',
      phase: 'upload',
      outcome: 'not-sent',
    })
    expect(FakeXhr.sent).toHaveLength(0)
    expect(upload.status.value).toBe('error')
    host.stop()
  })

  describe('an identity change between phases sends no later phase', () => {
    it('while prepare is in flight', async () => {
      const session = deferred<Session>()
      const host = workflowHost({
        'files:createSession': () => session.promise,
        'files:claim': () => ({ fileId: 'never' }),
      })
      const upload = sessionUpload(host)

      const pending = upload.upload(textFile(), { args: { folder: 'x' } })
      await vi.waitFor(() => expect(host.calls('files:createSession')).toHaveLength(1))
      host.advanceIdentity()
      expect(upload.status.value).toBe('idle')
      await expect(pending).rejects.toMatchObject({
        code: 'IDENTITY_CHANGED',
        phase: 'prepare',
        outcome: 'unknown',
        functionName: 'files:createSession',
      })

      session.resolve(SESSION)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(FakeXhr.sent).toHaveLength(0)
      expect(host.calls('files:claim')).toHaveLength(0)
      host.stop()
    })

    it('after prepare settled, before the storage POST', async () => {
      const host = workflowHost({
        'files:createSession': () => SESSION,
        'files:claim': () => ({ fileId: 'never' }),
      })
      const upload = sessionUpload(host, { url: () => host.advanceIdentity() })

      await expect(upload.upload(textFile(), { args: { folder: 'x' } })).rejects.toMatchObject({
        code: 'IDENTITY_CHANGED',
        phase: 'upload',
        outcome: 'not-sent',
      })
      expect(FakeXhr.sent).toHaveLength(0)
      expect(host.calls('files:claim')).toHaveLength(0)
      expect(upload.status.value).toBe('idle')
      host.stop()
    })

    it('while the storage POST is in flight', async () => {
      const host = workflowHost({
        'files:createSession': () => SESSION,
        'files:claim': () => ({ fileId: 'never' }),
      })
      const upload = sessionUpload(host)

      const pending = upload.upload(textFile(), { args: { folder: 'x' } })
      const xhr = await nextXhr()
      host.advanceIdentity()
      await expect(pending).rejects.toMatchObject({
        code: 'IDENTITY_CHANGED',
        phase: 'upload',
        outcome: 'unknown',
      })
      expect(FakeXhr.aborted).toBe(1)
      xhr.respond()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(host.calls('files:claim')).toHaveLength(0)
      expect(upload.status.value).toBe('idle')
      host.stop()
    })

    it('after the file was stored, before complete is sent', async () => {
      const host = workflowHost({
        'files:createSession': () => SESSION,
        'files:claim': () => ({ fileId: 'never' }),
      })
      const upload = sessionUpload(host, { complete: () => host.advanceIdentity() })

      const pending = upload.upload(textFile(), { args: { folder: 'x' } })
      ;(await nextXhr()).respond()
      // The stored file exists; the completion that would reference it was never sent.
      await expect(pending).rejects.toMatchObject({
        code: 'IDENTITY_CHANGED',
        phase: 'complete',
        outcome: 'not-sent',
        functionName: 'files:claim',
      })
      expect(host.calls('files:claim')).toHaveLength(0)
      expect(upload.status.value).toBe('idle')
      host.stop()
    })
  })

  it.each([
    {
      label: 'a prepare rejection',
      handlers: {
        'files:createSession': () => Promise.reject(new ConvexError({ code: 'QUOTA' })),
      },
      respond: undefined,
      expected: { kind: 'server', code: 'QUOTA', phase: 'prepare', outcome: undefined },
    },
    {
      label: 'a storage failure status',
      handlers: { 'files:createSession': () => SESSION },
      respond: (xhr: FakeXhr) => xhr.respond('x', 500),
      expected: { code: 'UPSTREAM_ERROR', phase: 'upload', outcome: undefined },
    },
    {
      label: 'a lost storage connection',
      handlers: { 'files:createSession': () => SESSION },
      respond: (xhr: FakeXhr) => xhr.failNetwork(),
      expected: {
        kind: 'transport',
        code: 'NETWORK_ERROR',
        phase: 'upload',
        outcome: 'unknown',
        functionName: 'files:createSession',
      },
    },
    {
      label: 'a complete rejection',
      handlers: {
        'files:createSession': () => SESSION,
        'files:claim': () => Promise.reject(new ConvexError({ code: 'EXPIRED' })),
      },
      respond: (xhr: FakeXhr) => xhr.respond(),
      expected: {
        kind: 'server',
        code: 'EXPIRED',
        phase: 'complete',
        outcome: undefined,
        functionName: 'files:claim',
      },
    },
  ])(
    'reports the failed phase and its outcome for $label',
    async ({ handlers, respond, expected }) => {
      const host = workflowHost(handlers as Record<string, Handler>)
      const upload = sessionUpload(host)

      const pending = upload.upload(textFile(), { args: { folder: 'x' } })
      if (respond) respond(await nextXhr())
      const error = (await pending.catch((cause: unknown) => cause)) as ConvexCallError
      // `outcome: undefined` asserts no dispatch outcome was recorded.
      expect(error).toMatchObject(expected)
      expect(upload.status.value).toBe('error')
      expect(upload.error.value).toBe(error)
      host.stop()
    },
  )

  it('completes against the per-call context captured when upload() was called', async () => {
    const host = workflowHost({
      'files:createSession': () => SESSION,
      'files:claim': () => ({ fileId: 'file_1' }),
    })
    type Target = { sessionId: string; token: string; tags: string[] }
    // Component state the application selects the completion target from.
    const selection = reactive<Target>({ sessionId: 'selected_a', token: 'token_a', tags: ['a'] })
    const seen: { url?: Target; complete?: Target } = {}
    const upload = host.run(() =>
      useConvexFileUpload(createSession, {
        url: (session, { context }: { file: File; context: Target }) => {
          seen.url = context
          return session.uploadUrl
        },
        complete: (op, { storageId, context }: UploadCompleteContext<Session, Target>) => {
          seen.complete = context
          return op.mutation(claimUpload, {
            sessionId: context.sessionId,
            token: context.token,
            storageId,
          })
        },
      }),
    )

    const pending = upload.upload(textFile(), { args: { folder: 'x' }, context: selection })
    // The selection changes while the upload-URL mutation and the POST run.
    selection.sessionId = 'selected_b'
    selection.token = 'token_b'
    selection.tags.push('b')
    ;(await nextXhr()).respond('storage_5')

    await expect(pending).resolves.toMatchObject({ completed: { fileId: 'file_1' } })
    expect(host.calls('files:claim')[0]?.[1]).toEqual({
      sessionId: 'selected_a',
      token: 'token_a',
      storageId: 'storage_5',
    })
    const captured = { sessionId: 'selected_a', token: 'token_a', tags: ['a'] }
    expect(seen.url).toEqual(captured)
    expect(seen.complete).toEqual(captured)
    host.stop()
  })

  it('hands each upload its own context', async () => {
    const host = workflowHost({
      'files:generateUploadUrl': () => 'https://upload.test/plain',
      'evidence:attach': (args) => (args as { originalName: string }).originalName,
    })
    const upload = host.run(() =>
      useConvexFileUpload(uploadUrl, {
        complete: (op, { storageId, context }: UploadCompleteContext<string, string>) =>
          op.action(attachEvidence, { storageId, originalName: context }),
      }),
    )

    const first = upload.upload(textFile(), { context: 'first' })
    ;(await nextXhr()).respond('storage_1')
    await expect(first).resolves.toEqual({
      storageId: 'storage_1',
      prepared: 'https://upload.test/plain',
      completed: 'first',
    })
    expect(host.calls('evidence:attach')[0]?.[1]).toEqual({
      storageId: 'storage_1',
      originalName: 'first',
    })
    FakeXhr.sent = []
    const second = upload.upload(textFile(), { context: 'second' })
    ;(await nextXhr()).respond('storage_2')
    await expect(second).resolves.toMatchObject({ completed: 'second' })
    host.stop()
  })

  it('cancel() during the storage POST aborts it with an open outcome', async () => {
    const host = workflowHost({
      'files:createSession': () => SESSION,
      'files:claim': () => ({ fileId: 'never' }),
    })
    const upload = sessionUpload(host)

    const pending = upload.upload(textFile(), { args: { folder: 'x' } })
    await nextXhr()
    upload.cancel()
    await expect(pending).rejects.toMatchObject({
      code: 'CANCELLED',
      phase: 'upload',
      outcome: 'unknown',
    })
    expect(FakeXhr.aborted).toBe(1)
    expect(host.calls('files:claim')).toHaveLength(0)
    expect(upload.status.value).toBe('idle')
    host.stop()
  })

  it('cancel() during prepare never sends the storage POST', async () => {
    const session = deferred<Session>()
    const host = workflowHost({ 'files:createSession': () => session.promise })
    const upload = sessionUpload(host)

    const pending = upload.upload(textFile(), { args: { folder: 'x' } })
    await vi.waitFor(() => expect(host.calls('files:createSession')).toHaveLength(1))
    upload.cancel()
    expect(upload.status.value).toBe('idle')
    session.resolve(SESSION)

    await expect(pending).rejects.toMatchObject({
      code: 'CANCELLED',
      phase: 'upload',
      outcome: 'not-sent',
    })
    expect(FakeXhr.sent).toHaveLength(0)
    host.stop()
  })

  it('cancel() during complete lets the sent completion settle with its real result', async () => {
    const claim = deferred<{ fileId: string }>()
    const host = workflowHost({
      'files:createSession': () => SESSION,
      'files:claim': () => claim.promise,
    })
    const upload = sessionUpload(host)

    const pending = upload.upload(textFile(), { args: { folder: 'x' } })
    ;(await nextXhr()).respond()
    await vi.waitFor(() => expect(host.calls('files:claim')).toHaveLength(1))
    upload.cancel()
    expect(upload.status.value).toBe('idle')
    claim.resolve({ fileId: 'file_1' })

    await expect(pending).resolves.toMatchObject({ completed: { fileId: 'file_1' } })
    // Cancellation owns the state; the finished work is not republished.
    expect(upload.status.value).toBe('idle')
    expect(upload.data.value).toBeUndefined()
    host.stop()
  })
})

it('captures upload args and cyclic context before authentication settles', async () => {
  const auth = deferred<undefined>()
  const mutation = vi.fn(async (_reference: unknown, _args: unknown) => SESSION)
  const host = attachedVueHost({ mutation }, { settlement: () => auth.promise })
  const selected = ref('asset-original')
  const context: { selected: typeof selected; self?: unknown } = { selected }
  context.self = context
  const complete = vi.fn(
    async (_op: unknown, detail: UploadCompleteContext<Session, typeof context>) => {
      expect(detail.context).not.toBe(context)
      expect(detail.context.self).toBe(detail.context)
      expect(detail.context.selected).toBe('asset-original')
      return 'completed'
    },
  )
  const upload = host.run(() =>
    useConvexFileUpload(createSession, {
      url: (session) => session.uploadUrl,
      complete,
    }),
  )
  const folder = ref('original')
  const args = { folder, nested: { label: 'original' } }
  const pending = upload.upload(textFile(), { args: args as never, context })
  expect(mutation).not.toHaveBeenCalled()
  folder.value = 'changed'
  args.nested.label = 'changed'
  selected.value = 'asset-changed'
  auth.resolve(undefined)
  const xhr = await nextXhr()
  xhr.respond()
  await pending
  expect(mutation.mock.calls[0]?.[1]).toEqual({ folder: 'original', nested: { label: 'original' } })
  expect(complete).toHaveBeenCalledTimes(1)
  host.stop()
})

it('captures upload prepare arguments independently of operation step snapshots', async () => {
  const auth = deferred<undefined>()
  const mutation = vi.fn(async (_reference: unknown, _args: unknown) => SESSION)
  const host = attachedVueHost({ mutation })
  const operations = host.run(() => useOperationController('upload snapshot test'))
  const upload = createFileUploadController({
    functionName: 'files:createSession',
    available: true,
    operations,
    prepare: async (operation, args) => {
      await auth.promise
      return operation.mutation(createSession, args as never)
    },
    url: () => SESSION.uploadUrl,
  })
  const folder = ref('original')
  const args = { folder, nested: { label: 'original' } }
  const pending = upload.upload(textFile(), args)
  folder.value = 'changed'
  args.nested.label = 'changed'
  expect(mutation).not.toHaveBeenCalled()
  auth.resolve(undefined)
  const xhr = await nextXhr()
  xhr.respond()
  await pending
  expect(mutation.mock.calls[0]?.[1]).toEqual({ folder: 'original', nested: { label: 'original' } })
  upload.dispose()
  host.stop()
})
