import { ConvexError } from 'convex/values'
import { describe, expect, it, vi } from 'vitest'

import { ConvexCallError } from '../../packages/vue/src/errors'
import {
  createCallableController,
  type CallableControllerObserver,
} from '../../packages/vue/src/internal/callable-controller'
import {
  createIdentityChangedError,
  isIdentityChangedError,
} from '../../packages/vue/src/internal/identity-changed-error'
import { createOperationController } from '../../packages/vue/src/internal/operation-controller'

interface CallableHandlers<Args, Result> {
  settle?: () => Promise<void>
  invoke: (args: Args) => Promise<Result>
}

/** The callable over the shared operation fence, with a stubbed transport. */
function createCallable<Args, Result>(input: {
  operation: 'mutation' | 'action'
  functionName?: string
  getIdentityGeneration: () => number
  subscribeIdentityChange?: (listener: () => void) => () => void
  handlers: CallableHandlers<Args, Result>
  observer?: CallableControllerObserver<Args, Result>
}) {
  return createCallableController<Args, Result>({
    operation: input.operation,
    functionName: input.functionName,
    observer: input.observer,
    operations: createOperationController({
      getIdentityGeneration: input.getIdentityGeneration,
      subscribeIdentityChange: input.subscribeIdentityChange,
      settle: input.handlers.settle,
      client: null,
    }),
    invoke: (call, args) =>
      call.step({
        kind: input.operation,
        functionName: input.functionName,
        dispatch: () => input.handlers.invoke(args),
      }),
  })
}

function makeLifecycle<Result = string>(
  handlers: CallableHandlers<Record<string, unknown>, Result>,
  getIdentityGeneration: () => number = () => 0,
  subscribeIdentityChange?: (listener: () => void) => () => void,
  operation: 'mutation' | 'action' = 'mutation',
  functionName?: string,
) {
  return createCallable<Record<string, unknown>, Result>({
    operation,
    functionName,
    getIdentityGeneration,
    subscribeIdentityChange,
    handlers,
  })
}

describe('callable lifecycle: one throwing error protocol', () => {
  it.each([
    ['plain Error', () => new Error('boom')],
    ['ConvexError', () => new ConvexError({ code: 'X', reason: 'y' })],
    ['string', () => 'bare string failure'],
    ['opaque object', () => ({ unrelated: 1 })],
  ])('normalizes a %s to ConvexCallError', async (_name, make) => {
    const lifecycle = makeLifecycle({ invoke: () => Promise.reject(make()) })

    const thrown = await lifecycle.run({}).catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(ConvexCallError)
    expect(lifecycle.status.value).toBe('error')
    expect(lifecycle.error.value).toBe(thrown)
  })

  it('commits successful data and clears the previous error', async () => {
    let shouldFail = true
    const failure = new ConvexCallError({ kind: 'server', message: 'remote failure' })
    const lifecycle = makeLifecycle({
      invoke: async () => {
        if (shouldFail) throw failure
        return 'committed'
      },
    })

    await expect(lifecycle.run({})).rejects.toBe(failure)
    expect(lifecycle.error.value).toBe(failure)

    shouldFail = false
    await expect(lifecycle.run({})).resolves.toBe('committed')
    expect(lifecycle.data.value).toBe('committed')
    expect(lifecycle.error.value).toBeUndefined()
  })

  it('keeps diagnostics non-authoritative on success and failure', async () => {
    const remoteFailure = new ConvexCallError({ kind: 'server', message: 'remote failure' })
    let shouldFail = false
    const startEvent = vi.fn(() => {
      throw new Error('diagnostics unavailable')
    })
    const finishEvent = vi.fn(() => {
      throw new Error('diagnostics unavailable')
    })
    const failEvent = vi.fn(() => {
      throw new Error('diagnostics unavailable')
    })
    const lifecycle = createCallable<Record<string, unknown>, string>({
      operation: 'mutation',
      getIdentityGeneration: () => 0,
      handlers: {
        invoke: async () => {
          if (shouldFail) throw remoteFailure
          return 'committed'
        },
      },
      observer: { startEvent, finishEvent, failEvent },
    })

    await expect(lifecycle.run({ value: 'ok' })).resolves.toBe('committed')
    shouldFail = true
    await expect(lifecycle.run({ value: 'fail' })).rejects.toBe(remoteFailure)

    expect(startEvent).toHaveBeenCalledTimes(2)
    expect(finishEvent).toHaveBeenCalledWith(undefined, 'committed', expect.any(Number))
    expect(failEvent).toHaveBeenCalledWith(undefined, remoteFailure, expect.any(Number))
  })
})

describe('callable lifecycle: newest invocation and identity retirement', () => {
  it('lets only the newest out-of-order completion own state', async () => {
    let resolveFirst!: (value: string) => void
    let resolveSecond!: (value: string) => void
    let invocation = 0
    const lifecycle = makeLifecycle({
      invoke: () => {
        invocation += 1
        return invocation === 1
          ? new Promise<string>((resolve) => {
              resolveFirst = resolve
            })
          : new Promise<string>((resolve) => {
              resolveSecond = resolve
            })
      },
    })

    const first = lifecycle.run({ call: 1 })
    const second = lifecycle.run({ call: 2 })
    resolveSecond('newest')
    await expect(second).resolves.toBe('newest')
    resolveFirst('older')
    await expect(first).resolves.toBe('older')

    expect(lifecycle.status.value).toBe('success')
    expect(lifecycle.data.value).toBe('newest')
  })

  it('rejects a mid-flight completion from a retired identity and masks its state', async () => {
    let generation = 0
    let releaseInvoke!: (value: string) => void
    let notifyIdentityChange!: () => void
    const lifecycle = makeLifecycle(
      {
        invoke: () =>
          new Promise<string>((resolve) => {
            releaseInvoke = resolve
          }),
      },
      () => generation,
      (listener) => {
        notifyIdentityChange = listener
        return () => {}
      },
    )

    const pending = lifecycle.run({})
    await vi.waitFor(() => expect(releaseInvoke).toBeTypeOf('function'))
    generation = 1
    notifyIdentityChange()
    releaseInvoke('wire-ok')

    // Sent before the identity changed: it may have committed.
    await expect(pending).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
      kind: 'authentication',
      outcome: 'unknown',
    })
    expect(lifecycle.status.value).toBe('idle')
    expect(lifecycle.error.value).toBeUndefined()
    expect(lifecycle.data.value).toBeUndefined()
  })

  it('passes owner-produced identity retirement through, named and masked', async () => {
    const lifecycle = makeLifecycle(
      { invoke: () => Promise.reject(createIdentityChangedError('mutation')) },
      undefined,
      undefined,
      'mutation',
      'notes:create',
    )

    const rejection = await lifecycle.run({}).catch((error: unknown) => error)

    expect(isIdentityChangedError(rejection)).toBe(true)
    // The transport recorded no outcome, so the sent call stays open.
    expect(rejection).toMatchObject({ outcome: 'unknown', functionName: 'notes:create' })
    expect(lifecycle.status.value).toBe('idle')
    expect(lifecycle.error.value).toBeUndefined()
  })

  it("keeps the transport's own not-sent identity rejection", async () => {
    const lifecycle = makeLifecycle(
      {
        invoke: () =>
          Promise.reject(createIdentityChangedError('mutation', { outcome: 'not-sent' })),
      },
      undefined,
      undefined,
      'mutation',
      'notes:create',
    )

    await expect(lifecycle.run({})).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
      outcome: 'not-sent',
      functionName: 'notes:create',
    })
  })

  it('rejects promptly on an identity change even when the transport never settles', async () => {
    let generation = 0
    let notifyIdentityChange!: () => void
    const invoke = vi.fn(() => new Promise<string>(() => {}))
    const lifecycle = makeLifecycle(
      { invoke },
      () => generation,
      (listener) => {
        notifyIdentityChange = listener
        return () => {}
      },
    )

    const pending = lifecycle.run({})
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    generation = 1
    notifyIdentityChange()

    await expect(pending).rejects.toMatchObject({ code: 'IDENTITY_CHANGED', outcome: 'unknown' })
    expect(lifecycle.status.value).toBe('idle')
  })

  it('does not let an older identity rejection mask a newer in-flight call', async () => {
    let rejectFirst!: (error: Error) => void
    let resolveSecond!: (value: string) => void
    let invocation = 0
    const lifecycle = makeLifecycle({
      invoke: () => {
        invocation += 1
        return invocation === 1
          ? new Promise<string>((_resolve, reject) => {
              rejectFirst = reject
            })
          : new Promise<string>((resolve) => {
              resolveSecond = resolve
            })
      },
    })

    const first = lifecycle.run({})
    const second = lifecycle.run({})
    rejectFirst(createIdentityChangedError('mutation'))
    await expect(first).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
    expect(lifecycle.status.value).toBe('pending')

    resolveSecond('newer')
    await expect(second).resolves.toBe('newer')
    expect(lifecycle.status.value).toBe('success')
    expect(lifecycle.data.value).toBe('newer')
  })

  it('never exposes an unknown upstream message through state', async () => {
    const sentinel = 'CALLABLE_STATE_SECRET_2f03'
    const lifecycle = makeLifecycle({
      invoke: () => Promise.reject(new Error(`${sentinel}\n    at privateFrame (secret.ts:1:1)`)),
    })

    await expect(lifecycle.run({})).rejects.toMatchObject({ message: 'Unknown Convex error' })
    expect(lifecycle.error.value?.message).toBe('Unknown Convex error')
    expect(JSON.stringify(lifecycle.error.value)).not.toContain(sentinel)
  })
})

describe('callable lifecycle: settlement and disposal', () => {
  it.each(['mutation', 'action'] as const)(
    'does not dispatch a %s across a settlement-time identity change',
    async (operation) => {
      let generation = 0
      let releaseSettlement!: () => void
      let notifyIdentityChange!: () => void
      const invoke = vi.fn(async () => 'alice-result')
      const lifecycle = makeLifecycle(
        {
          settle: () =>
            new Promise<void>((resolve) => {
              releaseSettlement = resolve
            }),
          invoke,
        },
        () => generation,
        (listener) => {
          notifyIdentityChange = listener
          return () => {}
        },
        operation,
      )

      const pending = lifecycle.run({ request: 'before-settlement' })
      expect(lifecycle.pending.value).toBe(true)
      expect(invoke).not.toHaveBeenCalled()

      generation = 1
      notifyIdentityChange()
      releaseSettlement()

      await expect(pending).rejects.toMatchObject({
        code: 'IDENTITY_CHANGED',
        outcome: 'not-sent',
      })
      expect(invoke).not.toHaveBeenCalled()
      expect(lifecycle.status.value).toBe('idle')
    },
  )

  it('never sends a call that reset() retired while settlement was pending', async () => {
    let releaseSettlement!: () => void
    const invoke = vi.fn(async () => 'wire-result')
    const lifecycle = makeLifecycle(
      {
        settle: () =>
          new Promise<void>((resolve) => {
            releaseSettlement = resolve
          }),
        invoke,
      },
      undefined,
      undefined,
      'mutation',
      'notes:create',
    )

    const pending = lifecycle.run({})
    lifecycle.reset()
    releaseSettlement()

    await expect(pending).rejects.toMatchObject({
      code: 'CANCELLED',
      outcome: 'not-sent',
      functionName: 'notes:create',
    })
    expect(invoke).not.toHaveBeenCalled()
    expect(lifecycle.status.value).toBe('idle')
    expect(lifecycle.error.value).toBeUndefined()

    // The next call belongs to a fresh operation and is sent.
    const next = lifecycle.run({})
    releaseSettlement()
    await expect(next).resolves.toBe('wire-result')
    expect(lifecycle.status.value).toBe('success')
  })

  it('normalizes a settlement failure without dispatching', async () => {
    const invoke = vi.fn(async () => 'unreachable')
    const lifecycle = makeLifecycle({
      settle: async () => {
        throw new ConvexCallError({
          kind: 'authentication',
          message: 'Authentication failed',
        })
      },
      invoke,
    })

    await expect(lifecycle.run({})).rejects.toMatchObject({
      kind: 'authentication',
      outcome: 'not-sent',
    })
    expect(invoke).not.toHaveBeenCalled()
    expect(lifecycle.status.value).toBe('error')
  })

  it('disposal retires pending state and releases identity observation once', async () => {
    let generation = 1
    let notifyIdentityChange: (() => void) | undefined
    let releaseInvoke!: (value: string) => void
    const stopIdentity = vi.fn()
    const lifecycle = createCallable<Record<string, unknown>, string>({
      operation: 'mutation',
      getIdentityGeneration: () => generation,
      subscribeIdentityChange(listener) {
        notifyIdentityChange = listener
        return stopIdentity
      },
      handlers: {
        invoke: () =>
          new Promise<string>((resolve) => {
            releaseInvoke = resolve
          }),
      },
    })

    const pending = lifecycle.run({})
    lifecycle.dispose()
    lifecycle.dispose()
    releaseInvoke('late-result')

    await expect(pending).resolves.toBe('late-result')
    expect(lifecycle.status.value).toBe('idle')
    expect(lifecycle.data.value).toBeUndefined()
    expect(stopIdentity).toHaveBeenCalledTimes(1)

    generation = 2
    notifyIdentityChange?.()
    await expect(lifecycle.run({})).rejects.toMatchObject({
      kind: 'unknown',
      code: 'CANCELLED',
      outcome: 'not-sent',
    })
    expect(lifecycle.status.value).toBe('idle')
  })
})

describe('callable lifecycle: reset', () => {
  it('returns to idle and retires an in-flight success', async () => {
    let release!: (value: string) => void
    const lifecycle = makeLifecycle({
      invoke: () =>
        new Promise<string>((resolve) => {
          release = resolve
        }),
    })

    const pending = lifecycle.run({})
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    expect(lifecycle.status.value).toBe('pending')
    lifecycle.reset()
    expect(lifecycle.status.value).toBe('idle')
    expect(lifecycle.pending.value).toBe(false)

    release('late')
    await expect(pending).resolves.toBe('late')
    expect(lifecycle.status.value).toBe('idle')
    expect(lifecycle.data.value).toBeUndefined()
  })

  it('retires an in-flight failure and clears a settled result', async () => {
    let fail!: (error: unknown) => void
    let invocation = 0
    const lifecycle = makeLifecycle({
      invoke: () => {
        invocation += 1
        if (invocation === 1) return Promise.resolve('settled')
        return new Promise<string>((_resolve, reject) => {
          fail = reject
        })
      },
    })

    await lifecycle.run({})
    expect(lifecycle.data.value).toBe('settled')
    lifecycle.reset()
    expect(lifecycle.status.value).toBe('idle')
    expect(lifecycle.data.value).toBeUndefined()

    const pending = lifecycle.run({})
    await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
    lifecycle.reset()
    fail(new ConvexError({ code: 'LATE' }))
    await expect(pending).rejects.toMatchObject({ kind: 'server', code: 'LATE' })
    expect(lifecycle.status.value).toBe('idle')
    expect(lifecycle.error.value).toBeUndefined()
  })
})

describe('callable lifecycle: function names and library codes', () => {
  it('names normalized upstream failures', async () => {
    const lifecycle = makeLifecycle(
      { invoke: () => Promise.reject(new ConvexError('Title is already taken')) },
      undefined,
      undefined,
      'mutation',
      'notes:create',
    )

    await expect(lifecycle.run({})).rejects.toMatchObject({
      kind: 'server',
      message: 'Title is already taken',
      functionName: 'notes:create',
    })
    expect(lifecycle.error.value?.functionName).toBe('notes:create')
    // A confirmed server rejection records no dispatch outcome.
    expect(lifecycle.error.value?.outcome).toBeUndefined()
  })

  it('names an identity retirement detected at settlement', async () => {
    let generation = 0
    let release!: (value: string) => void
    const controllerRetired = makeLifecycle(
      {
        invoke: () =>
          new Promise<string>((resolve) => {
            release = resolve
          }),
      },
      () => generation,
      undefined,
      'action',
      'reports:generate',
    )
    const pending = controllerRetired.run({})
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    generation = 1
    release('stale')
    const rejection = await pending.catch((error: unknown) => error)
    expect(isIdentityChangedError(rejection)).toBe(true)
    expect(rejection).toMatchObject({
      kind: 'authentication',
      code: 'IDENTITY_CHANGED',
      functionName: 'reports:generate',
    })
  })

  it('names the cancellation of a disposed callable', async () => {
    const lifecycle = makeLifecycle(
      { invoke: async () => 'unreachable' },
      undefined,
      undefined,
      'mutation',
      'notes:create',
    )
    lifecycle.dispose()
    await expect(lifecycle.run({})).rejects.toMatchObject({
      code: 'CANCELLED',
      functionName: 'notes:create',
    })
  })

  it('commits an application IDENTITY_CHANGED code as an ordinary server failure', async () => {
    const lifecycle = makeLifecycle({
      invoke: () => Promise.reject(new ConvexError({ code: 'IDENTITY_CHANGED' })),
    })

    const rejection = await lifecycle.run({}).catch((error: unknown) => error)
    expect(rejection).toMatchObject({ kind: 'server', code: 'IDENTITY_CHANGED' })
    expect(isIdentityChangedError(rejection)).toBe(false)
    expect(lifecycle.status.value).toBe('error')
    expect(lifecycle.error.value).toBe(rejection)
  })
})
