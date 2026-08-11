import { ConvexError } from 'convex/values'
import { describe, expect, it, vi } from 'vitest'

import { ConvexCallError } from '../../packages/vue/src/errors'
import {
  createCallableController,
  type CallableControllerHandlers,
} from '../../packages/vue/src/internal/callable-controller'
import {
  createIdentityChangedError,
  isIdentityChangedError,
} from '../../packages/vue/src/internal/identity-changed-error'

function makeLifecycle<Result = string>(
  handlers: CallableControllerHandlers<Record<string, unknown>, Result>,
  getIdentityGeneration: () => number = () => 0,
  subscribeIdentityChange?: (listener: () => void) => () => void,
  operation: 'mutation' | 'action' = 'mutation',
) {
  return createCallableController<Record<string, unknown>, Result>({
    operation,
    getIdentityGeneration,
    subscribeIdentityChange,
    handlers,
  })
}

describe('callable lifecycle: one throwing error protocol', () => {
  const rawFailures: Array<{ name: string; make: () => unknown }> = [
    { name: 'plain Error', make: () => new Error('boom') },
    {
      name: 'ConvexError',
      make: () => new ConvexError({ code: 'X', reason: 'y' }),
    },
    { name: 'string', make: () => 'bare string failure' },
    { name: 'opaque object', make: () => ({ unrelated: 1 }) },
  ]

  for (const { name, make } of rawFailures) {
    it(`normalizes ${name} to ConvexCallError`, async () => {
      const lifecycle = makeLifecycle({ invoke: () => Promise.reject(make()) })

      let thrown: unknown
      try {
        await lifecycle.run({})
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(ConvexCallError)
      expect(lifecycle.status.value).toBe('error')
      expect(lifecycle.error.value).toBe(thrown)
    })
  }

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
    const lifecycle = createCallableController<Record<string, unknown>, string>({
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
    generation = 1
    notifyIdentityChange()
    releaseInvoke('wire-ok')

    await expect(pending).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
      kind: 'authentication',
    })
    expect(lifecycle.status.value).toBe('idle')
    expect(lifecycle.error.value).toBeUndefined()
    expect(lifecycle.data.value).toBeUndefined()
  })

  it('passes owner-produced identity retirement through and remains masked', async () => {
    const lifecycle = makeLifecycle({
      invoke: () => Promise.reject(createIdentityChangedError('mutation')),
    })

    let rejection: unknown
    try {
      await lifecycle.run({})
    } catch (error) {
      rejection = error
    }

    expect(isIdentityChangedError(rejection)).toBe(true)
    expect(lifecycle.status.value).toBe('idle')
    expect(lifecycle.error.value).toBeUndefined()
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

      await expect(pending).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
      expect(invoke).not.toHaveBeenCalled()
      expect(lifecycle.status.value).toBe('idle')
    },
  )

  it('keeps an internal retirement reset final while settlement is pending', async () => {
    let releaseSettlement!: () => void
    const lifecycle = makeLifecycle({
      settle: () =>
        new Promise<void>((resolve) => {
          releaseSettlement = resolve
        }),
      invoke: async () => 'wire-result',
    })

    const pending = lifecycle.run({})
    lifecycle.reset()
    releaseSettlement()

    await expect(pending).resolves.toBe('wire-result')
    expect(lifecycle.status.value).toBe('idle')
    expect(lifecycle.data.value).toBeUndefined()
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

    await expect(lifecycle.run({})).rejects.toMatchObject({ kind: 'authentication' })
    expect(invoke).not.toHaveBeenCalled()
    expect(lifecycle.status.value).toBe('error')
  })

  it('disposal retires pending state and releases identity observation once', async () => {
    let generation = 1
    let notifyIdentityChange: (() => void) | undefined
    let releaseInvoke!: (value: string) => void
    const stopIdentity = vi.fn()
    const lifecycle = createCallableController<Record<string, unknown>, string>({
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
    await expect(lifecycle.run({})).rejects.toMatchObject({ code: 'CALL_DISPOSED' })
  })
})
