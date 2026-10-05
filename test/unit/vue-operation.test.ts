import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { ConvexError } from 'convex/values'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useConvexOperation, type ConvexOperation } from '../../packages/vue/src'
import { isConvexCallError } from '../../packages/vue/src/errors'
import { createOperationController } from '../../packages/vue/src/internal/operation-controller'
import { attachedVueHost } from '../helpers/attached-vue-host'

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
  open() {}
  setRequestHeader() {}
  send() {
    FakeXhr.sent.push(this)
    this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 } as ProgressEvent)
  }
  abort() {
    FakeXhr.aborted += 1
    this.onabort?.()
  }
  respond(storageId: string) {
    this.status = 200
    this.responseText = JSON.stringify({ storageId })
    this.onload?.()
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

const createNote = makeFunctionReference<'mutation'>('notes:create') as FunctionReference<
  'mutation',
  'public',
  { title: string },
  string
>
const summarize = makeFunctionReference<'action'>('notes:summarize') as FunctionReference<
  'action',
  'public',
  { noteId: string },
  string
>
const getNote = makeFunctionReference<'query'>('notes:get') as FunctionReference<
  'query',
  'public',
  { noteId: string },
  { title: string }
>

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

/** Start a run whose work never settles and hand out its operation. */
function beginIn(state: {
  run: (work: (op: ConvexOperation) => Promise<unknown>) => Promise<unknown>
}): ConvexOperation {
  let captured: ConvexOperation | undefined
  state
    .run((op) => {
      captured = op
      return new Promise(() => {})
    })
    .catch(() => {})
  if (!captured) throw new Error('the run did not start its work synchronously')
  return captured
}

function operationHost(
  answers: {
    mutation?: (args: unknown) => Promise<unknown>
    action?: (args: unknown) => Promise<unknown>
    query?: (args: unknown) => Promise<unknown>
  } = {},
  settlement?: Promise<void>,
) {
  const mutation = vi.fn((_ref: unknown, args: unknown) =>
    (answers.mutation ?? (async () => 'note_1'))(args),
  )
  const action = vi.fn((_ref: unknown, args: unknown) =>
    (answers.action ?? (async () => 'summary'))(args),
  )
  const query = vi.fn((_ref: unknown, args: unknown) =>
    (answers.query ?? (async () => ({ title: 'Hello' })))(args),
  )
  const host = attachedVueHost(
    { query, mutation, action },
    settlement ? { settlement: () => settlement } : {},
  )
  const state = host.run(() =>
    useConvexOperation((op, work: (op: ConvexOperation) => Promise<unknown>) => work(op)),
  )
  return { ...host, state, begin: () => beginIn(state), mutation, action, query }
}

describe('useConvexOperation', () => {
  it('runs query, mutation, and action steps with their results', async () => {
    const host = operationHost()
    const op = host.begin()

    await expect(op.query(getNote, { noteId: 'n' })).resolves.toEqual({ title: 'Hello' })
    await expect(op.mutation(createNote, { title: 'Hello' })).resolves.toBe('note_1')
    await expect(op.action(summarize, { noteId: 'n' })).resolves.toBe('summary')
    expect(host.mutation.mock.calls[0]?.[1]).toEqual({ title: 'Hello' })
    expect(op.retired).toBe(false)
    host.stop()
  })

  it('captures the identity at begin(), not when the composable was created', async () => {
    const host = operationHost()
    host.advanceIdentity()

    const op = host.begin()
    await expect(op.mutation(createNote, { title: 'Bob' })).resolves.toBe('note_1')
    expect(op.retired).toBe(false)
    host.stop()
  })

  it.each([
    ['mutation', (op: ConvexOperation) => op.mutation(createNote, { title: 'x' })],
    ['action', (op: ConvexOperation) => op.action(summarize, { noteId: 'n' })],
    ['query', (op: ConvexOperation) => op.query(getNote, { noteId: 'n' })],
    ['upload', (op: ConvexOperation) => op.upload('https://upload.test', new Blob(['x']))],
  ] as const)('never sends a %s step after the identity changed', async (_kind, step) => {
    const host = operationHost()
    const op = host.begin()
    host.advanceIdentity()

    await expect(step(op)).rejects.toMatchObject({
      kind: 'authentication',
      code: 'IDENTITY_CHANGED',
      outcome: 'not-sent',
    })
    expect(host.mutation).not.toHaveBeenCalled()
    expect(host.action).not.toHaveBeenCalled()
    expect(host.query).not.toHaveBeenCalled()
    expect(FakeXhr.sent).toHaveLength(0)
    expect(op.retired).toBe(true)
    host.stop()
  })

  it('checks the identity after authentication settles, immediately before sending', async () => {
    const settlement = deferred<undefined>()
    const host = operationHost({}, settlement.promise)
    const op = host.begin()

    const pending = op.mutation(createNote, { title: 'x' })
    host.advanceIdentity()
    settlement.resolve(undefined)

    await expect(pending).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
      outcome: 'not-sent',
      functionName: 'notes:create',
    })
    expect(host.mutation).not.toHaveBeenCalled()
    host.stop()
  })

  it('rejects a result that settles after an unobserved identity change as unknown', async () => {
    const result = deferred<string>()
    const host = operationHost({ mutation: () => result.promise })
    const op = host.begin()

    const pending = op.mutation(createNote, { title: 'x' })
    await vi.waitFor(() => expect(host.mutation).toHaveBeenCalledTimes(1))
    // Drop the subscription: only the settlement-time check can see the change.
    host.listeners.clear()
    host.advanceIdentity()
    result.resolve('note_old')

    await expect(pending).rejects.toMatchObject({ code: 'IDENTITY_CHANGED', outcome: 'unknown' })
    host.stop()
  })

  it('keeps a confirmed server rejection free of dispatch outcome', async () => {
    const host = operationHost({
      mutation: () => Promise.reject(new ConvexError({ code: 'TITLE_TAKEN' })),
    })
    const error = await host
      .begin()
      .mutation(createNote, { title: 'x' })
      .catch((cause: unknown) => cause)

    expect(error).toMatchObject({
      kind: 'server',
      code: 'TITLE_TAKEN',
      functionName: 'notes:create',
    })
    expect(isConvexCallError(error) && error.outcome).toBeUndefined()
    host.stop()
  })

  it('aborts its signal on an identity change so app code can stop too', () => {
    const host = operationHost()
    const op = host.begin()
    const onAbort = vi.fn()
    op.signal.addEventListener('abort', onAbort)

    host.advanceIdentity()
    expect(onAbort).toHaveBeenCalledTimes(1)
    expect(op.retired).toBe(true)
    expect(op.signal.reason).toMatchObject({ code: 'IDENTITY_CHANGED' })
    host.stop()
  })

  it('cancel() retires later steps as not sent; a sent step settles with its result', async () => {
    const result = deferred<string>()
    const host = operationHost({ mutation: () => result.promise })
    const op = host.begin()

    const sent = op.mutation(createNote, { title: 'x' })
    await vi.waitFor(() => expect(host.mutation).toHaveBeenCalledTimes(1))
    op.cancel()
    expect(op.retired).toBe(true)
    expect(op.signal.aborted).toBe(true)
    expect(op.signal.reason).toMatchObject({ code: 'CANCELLED' })

    await expect(op.action(summarize, { noteId: 'n' })).rejects.toMatchObject({
      code: 'CANCELLED',
      outcome: 'not-sent',
    })
    result.resolve('note_1')
    await expect(sent).resolves.toBe('note_1')
    expect(host.action).not.toHaveBeenCalled()
    host.stop()
  })

  it('returns to idle after cancel(), like reset(), instead of showing CANCELLED as an error', async () => {
    const host = operationHost()

    await expect(
      host.state.run(async (op) => {
        op.cancel()
        return op.mutation(createNote, { title: 'x' })
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED', outcome: 'not-sent' })
    expect(host.state.status.value).toBe('idle')
    expect(host.state.error.value).toBeUndefined()
    host.stop()
  })

  it('keeps an application error with the code CANCELLED as an error', async () => {
    const host = operationHost({
      mutation: () =>
        Promise.reject(new ConvexError({ code: 'CANCELLED', message: 'Order cancelled' })),
    })

    await expect(
      host.state.run((op) => op.mutation(createNote, { title: 'x' })),
    ).rejects.toMatchObject({ kind: 'server', code: 'CANCELLED' })
    expect(host.state.status.value).toBe('error')
    expect(host.state.error.value).toMatchObject({ kind: 'server', code: 'CANCELLED' })
    host.stop()
  })

  it('keeps an identity change as the reason when cancel() follows it', async () => {
    const host = operationHost()
    const op = host.begin()
    host.advanceIdentity()
    op.cancel()

    await expect(op.mutation(createNote, { title: 'x' })).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
    })
    host.stop()
  })

  it('retires every operation when its scope is disposed', async () => {
    const host = operationHost()
    const runtimeListeners = host.listeners.size
    const op = host.begin()
    const signal = op.signal

    host.stop()
    expect(signal.aborted).toBe(true)
    expect(op.retired).toBe(true)
    await expect(op.mutation(createNote, { title: 'x' })).rejects.toMatchObject({
      code: 'CANCELLED',
      outcome: 'not-sent',
    })
    await expect(
      host.state.run((later) => later.mutation(createNote, { title: 'x' })),
    ).rejects.toMatchObject({ code: 'CANCELLED', outcome: 'not-sent' })
    expect(host.mutation).not.toHaveBeenCalled()
    expect(host.listeners.size).toBe(runtimeListeners - 1)
  })

  it('uploads bytes with progress and aborts an in-flight upload on identity change', async () => {
    const host = operationHost()
    const progress = vi.fn()
    const op = host.begin()

    const first = op.upload('https://upload.test', new Blob(['data']), { onProgress: progress })
    FakeXhr.sent[0]!.respond('storage_1')
    await expect(first).resolves.toBe('storage_1')
    expect(progress).toHaveBeenCalledWith({ loaded: 1, total: 4, percent: 25 })

    const second = op.upload('https://upload.test', new Blob(['data']))
    host.advanceIdentity()
    await expect(second).rejects.toMatchObject({ code: 'IDENTITY_CHANGED', outcome: 'unknown' })
    expect(FakeXhr.aborted).toBe(1)
    host.stop()
  })

  it.each([
    [
      'FILE_TOO_LARGE',
      { maxSize: 3 },
      new Blob(['four'], { type: 'image/png' }),
      'exceeds maximum 3 bytes',
    ],
    [
      'FILE_TYPE_NOT_ALLOWED',
      { allowedTypes: ['image/*'] },
      new Blob(['x'], { type: 'application/pdf' }),
      'not allowed',
    ],
  ] as const)(
    'rejects an upload that fails its %s preflight before any request',
    async (code, limits, blob, message) => {
      const host = operationHost()
      const run = host.state.run((op) => op.upload('https://upload.test', blob, limits))

      const error = await run.catch((cause: unknown) => cause)
      expect(isConvexCallError(error, code)).toBe(true)
      expect(error).toMatchObject({ code, outcome: 'not-sent' })
      expect((error as Error).message).toContain(message)
      expect(FakeXhr.sent).toHaveLength(0)
      expect(host.state.error.value).toBe(error)
      host.stop()
    },
  )

  it('rejects every step without a browser runtime as not sent', async () => {
    const scope = effectScope()
    const state = scope.run(() =>
      useConvexOperation((op, work: (op: ConvexOperation) => Promise<unknown>) => work(op)),
    )!
    const op = beginIn(state)

    await expect(op.mutation(createNote, { title: 'x' })).rejects.toMatchObject({
      code: 'CLIENT_UNAVAILABLE',
      outcome: 'not-sent',
      functionName: 'notes:create',
    })
    globalThis.XMLHttpRequest = undefined as unknown as typeof XMLHttpRequest
    await expect(op.upload('https://upload.test', new Blob(['x']))).rejects.toMatchObject({
      code: 'CLIENT_UNAVAILABLE',
      outcome: 'not-sent',
    })
    scope.stop()
  })

  it('requires an effect scope and exposes only the public operation', () => {
    expect(() => useConvexOperation(async () => undefined)).toThrow(
      'must run inside a Vue effect scope',
    )
    const host = operationHost()
    expect(Object.keys(host.state).sort()).toEqual([
      'data',
      'error',
      'pending',
      'reset',
      'run',
      'status',
    ])
    const op = host.begin()
    expect(Object.isFrozen(op)).toBe(true)
    expect(Object.keys(op).sort()).toEqual([
      'action',
      'cancel',
      'mutation',
      'query',
      'retired',
      'signal',
      'upload',
    ])
    expect('step' in op).toBe(false)
    host.stop()
  })
})

describe('useConvexOperation state', () => {
  it('tracks the newest run in data, status, pending, and error', async () => {
    const note = deferred<string>()
    const host = operationHost({ mutation: () => note.promise })

    const publishing = host.state.run(async (op) => {
      const noteId = await op.mutation(createNote, { title: 'x' })
      return op.action(summarize, { noteId })
    })
    expect(host.state.pending.value).toBe(true)
    expect(host.state.status.value).toBe('pending')
    note.resolve('note_1')
    await expect(publishing).resolves.toBe('summary')
    expect(host.state.status.value).toBe('success')
    expect(host.state.data.value).toBe('summary')

    const failing = host.state.run(() => Promise.reject(new ConvexError({ code: 'QUOTA' })))
    await expect(failing).rejects.toMatchObject({ kind: 'server', code: 'QUOTA' })
    expect(host.state.status.value).toBe('error')
    expect(host.state.error.value).toMatchObject({ code: 'QUOTA' })
    expect(host.state.data.value).toBeUndefined()
    host.stop()
  })

  it("clears the previous identity's result and error when the identity changes", async () => {
    const host = operationHost()
    await host.state.run((op) => op.mutation(createNote, { title: 'x' }))
    expect(host.state.data.value).toBe('note_1')

    host.advanceIdentity()
    expect(host.state.status.value).toBe('idle')
    expect(host.state.data.value).toBeUndefined()

    await host.state.run(() => Promise.reject(new ConvexError({ code: 'QUOTA' }))).catch(() => {})
    expect(host.state.error.value).toMatchObject({ code: 'QUOTA' })
    host.advanceIdentity()
    expect(host.state.status.value).toBe('idle')
    expect(host.state.error.value).toBeUndefined()
    host.stop()
  })

  it('never shows an identity change that crossed a run as its error', async () => {
    const host = operationHost({ mutation: () => new Promise(() => {}) })

    const running = host.state.run((op) => op.mutation(createNote, { title: 'x' }))
    await vi.waitFor(() => expect(host.mutation).toHaveBeenCalledTimes(1))
    host.advanceIdentity()

    // Rejected without waiting for the transport, which never settles.
    await expect(running).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
      outcome: 'unknown',
      functionName: 'notes:create',
    })
    expect(host.state.status.value).toBe('idle')
    expect(host.state.error.value).toBeUndefined()
    host.stop()
  })

  it('reset() cancels a running operation: its next step is never sent', async () => {
    const gate = deferred<undefined>()
    const host = operationHost()

    const running = host.state.run(async (op) => {
      await gate.promise
      return op.mutation(createNote, { title: 'x' })
    })
    host.state.reset()
    expect(host.state.status.value).toBe('idle')
    gate.resolve(undefined)

    await expect(running).rejects.toMatchObject({ code: 'CANCELLED', outcome: 'not-sent' })
    expect(host.mutation).not.toHaveBeenCalled()
    expect(host.state.status.value).toBe('idle')
    expect(host.state.error.value).toBeUndefined()
    host.stop()
  })

  it('stops holding a finished operation: its signal never aborts later', async () => {
    const host = operationHost()
    const signals: AbortSignal[] = []
    for (let index = 0; index < 20; index += 1) {
      await host.state.run(async (op) => {
        signals.push(op.signal)
        return op.mutation(createNote, { title: `note ${index}` })
      })
    }

    host.advanceIdentity()
    expect(signals.filter((signal) => signal.aborted)).toEqual([])
    host.stop()
    expect(signals.filter((signal) => signal.aborted)).toEqual([])
  })
})

describe('operation controller: transport evidence', () => {
  it('releases a finished operation whose signal was read, but keeps it fenced', async () => {
    let generation = 0
    let notify!: () => void
    const controller = createOperationController({
      getIdentityGeneration: () => generation,
      subscribeIdentityChange: (listener) => {
        notify = listener
        return () => {}
      },
      client: {
        query: vi.fn() as never,
        action: vi.fn() as never,
        mutation: (async () => 'ok') as never,
      },
    })
    const running = controller.begin()
    const runningSignal = running.signal
    const finished = controller.begin()
    const finishedSignal = finished.signal
    await finished.mutation(createNote, { title: 'x' })
    finished.finish()

    generation = 1
    notify()
    expect(runningSignal.aborted).toBe(true)
    expect(finishedSignal.aborted).toBe(false)
    await expect(finished.mutation(createNote, { title: 'y' })).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
      outcome: 'not-sent',
    })
  })

  it('counts a step as sent unless its outcome proves it was not', async () => {
    let generation = 0
    const controller = createOperationController({
      getIdentityGeneration: () => generation,
      client: {
        query: vi.fn() as never,
        action: (() => Promise.reject(new ConvexError({ code: 'DENIED' }))) as never,
        mutation: (async () => 'ok') as never,
      },
    })
    const op = controller.begin()
    await op.mutation(createNote, { title: 'x' })
    await op.action(summarize, { noteId: 'n' }).catch(() => {})
    expect(op.sentSteps).toBe(2)

    generation = 1
    await op.mutation(createNote, { title: 'y' }).catch(() => {})
    expect(op.sentSteps).toBe(2)

    const unavailable = createOperationController({
      getIdentityGeneration: () => 0,
      client: null,
    }).begin()
    await unavailable.mutation(createNote, { title: 'x' }).catch(() => {})
    expect(unavailable.sentSteps).toBe(0)
  })

  it('does not keep operations observed after their steps settle', async () => {
    let generation = 0
    let notify!: () => void
    const controller = createOperationController({
      getIdentityGeneration: () => generation,
      subscribeIdentityChange: (listener) => {
        notify = listener
        return () => {}
      },
      client: {
        query: vi.fn() as never,
        action: vi.fn() as never,
        mutation: (async () => 'ok') as never,
      },
    })
    const op = controller.begin()
    await op.mutation(createNote, { title: 'x' })

    generation = 1
    notify()
    // Not retired eagerly (nothing observes it), but its next step still sees the change.
    await expect(op.mutation(createNote, { title: 'y' })).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
      outcome: 'not-sent',
    })
  })
})
