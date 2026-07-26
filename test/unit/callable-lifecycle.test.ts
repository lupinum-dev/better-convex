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

describe('callable lifecycle: throwing / .safe() equivalence ', () => {
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
    it(`produces an equal toJSON() and both instanceof for ${name}`, async () => {
      const lifecycle = makeLifecycle({
        invoke: () => Promise.reject(make()),
      })

      let thrown: unknown
      try {
        await lifecycle.run({})
      } catch (error) {
        thrown = error
      }
      const safe = await lifecycle.safe({})

      expect(thrown).toBeInstanceOf(ConvexCallError)
      expect(safe.ok).toBe(false)
      if (safe.ok) throw new Error('expected error result')
      expect(safe.error).toBeInstanceOf(ConvexCallError)
      expect((thrown as ConvexCallError).toJSON()).toEqual(safe.error.toJSON())
    })
  }

  it('keeps a committed result when onSuccess throws', async () => {
    const onSuccess = vi.fn(() => {
      throw new Error('application callback failed')
    })
    const lifecycle = makeLifecycle({
      invoke: async () => 'committed',
      onSuccess,
    })

    await expect(lifecycle.run({})).resolves.toBe('committed')
    await expect(lifecycle.safe({})).resolves.toEqual({ ok: true, data: 'committed' })
    expect(onSuccess).toHaveBeenCalledTimes(2)
    expect(lifecycle.data.value).toBe('committed')
    expect(lifecycle.error.value).toBeNull()
  })

  it('keeps the normalized remote failure when onError throws', async () => {
    const remoteFailure = new ConvexCallError({ kind: 'server', message: 'remote failure' })
    const onError = vi.fn(() => {
      throw new Error('application callback failed')
    })
    const lifecycle = makeLifecycle({
      invoke: () => Promise.reject(remoteFailure),
      onError,
    })

    await expect(lifecycle.run({})).rejects.toBe(remoteFailure)
    await expect(lifecycle.safe({})).resolves.toEqual({ ok: false, error: remoteFailure })
    expect(onError).toHaveBeenCalledTimes(2)
    expect(lifecycle.error.value).toBe(remoteFailure)
  })
})

describe('callable lifecycle: identity-change stale rejection (architecture invariant)', () => {
  it('rejects a mid-flight completion under a changed identity as IDENTITY_CHANGED and fires no callbacks', async () => {
    let generation = 0
    let releaseInvoke!: (value: string) => void
    const onSuccess = vi.fn()
    const onError = vi.fn()
    let notifyIdentityChange!: () => void

    const lifecycle = makeLifecycle(
      {
        invoke: () =>
          new Promise<string>((resolve) => {
            releaseInvoke = resolve
          }),
        onSuccess,
        onError,
      },
      () => generation,
      (listener) => {
        notifyIdentityChange = listener
        return () => {}
      },
    )

    const pending = lifecycle.run({})

    // Identity switches while the wire call is still in flight.
    generation = 1
    notifyIdentityChange()

    // The wire call then succeeds — but under the retired identity, so it is
    // retired rather than committed.
    releaseInvoke('wire-ok')

    let rejection: unknown
    try {
      await pending
    } catch (error) {
      rejection = error
    }

    expect(isIdentityChangedError(rejection)).toBe(true)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()

    // State is masked, not showing the stale result or a spurious error.
    expect(lifecycle.status.value).toBe('idle')
    expect(lifecycle.error.value).toBeNull()
    expect(lifecycle.data.value).toBeUndefined()
  })

  it('.safe() returns the IDENTITY_CHANGED error for a stale call, never the old result', async () => {
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

    const pending = lifecycle.safe({})
    generation = 1
    notifyIdentityChange()
    releaseInvoke('wire-ok')

    const result = await pending
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error result')
    expect(result.error.code).toBe('IDENTITY_CHANGED')
    expect(result.error.kind).toBe('authentication')
  })

  it('passes an owner-produced IDENTITY_CHANGED rejection through without callbacks (count rejections)', async () => {
    const onError = vi.fn()
    let rejections = 0

    const lifecycle = makeLifecycle({
      // The client owner rejects a retired-generation in-flight call itself.
      invoke: () => Promise.reject(createIdentityChangedError('mutation')),
      onError,
    })

    const attempts = 3
    for (let i = 0; i < attempts; i++) {
      try {
        await lifecycle.run({})
      } catch (error) {
        if (isIdentityChangedError(error)) rejections += 1
      }
    }

    expect(rejections).toBe(attempts)
    expect(onError).not.toHaveBeenCalled()
    // No error is committed to visible state for an identity-boundary rejection.
    expect(lifecycle.error.value).toBeNull()
    expect(lifecycle.status.value).toBe('pending')
  })

  it('commits and reports a genuine (non-identity) failure with one onError call', async () => {
    const sentinel = 'CALLBACK_STATE_SECRET_2f03'
    const onError = vi.fn()
    const lifecycle = makeLifecycle({
      invoke: () => Promise.reject(new Error(`${sentinel}\n    at privateFrame (secret.ts:1:1)`)),
      onError,
    })

    let rejected: unknown
    try {
      await lifecycle.run({})
    } catch (error) {
      rejected = error
    }
    expect(rejected).toBeInstanceOf(ConvexCallError)
    expect((rejected as ConvexCallError).message).toBe('Unknown Convex error')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(ConvexCallError)
    expect(onError.mock.calls[0]?.[0].message).toBe('Unknown Convex error')
    expect(lifecycle.status.value).toBe('error')
    expect(lifecycle.error.value?.message).toBe('Unknown Convex error')
    expect(
      JSON.stringify({
        rejected,
        callback: onError.mock.calls[0]?.[0],
        state: lifecycle.error.value,
      }),
    ).not.toContain(sentinel)
  })
})

describe('callable lifecycle: settlement binding', () => {
  it.each(['mutation', 'action'] as const)(
    'rejects a %s started before settlement when identity changes and never dispatches',
    async (operation) => {
      let generation = 0
      let releaseSettlement!: () => void
      let notifyIdentityChange!: () => void
      const invoke = vi.fn(async () => 'alice-result')
      const onSuccess = vi.fn()
      const onError = vi.fn()
      const lifecycle = makeLifecycle(
        {
          settle: () =>
            new Promise<void>((resolve) => {
              releaseSettlement = resolve
            }),
          invoke,
          onSuccess,
          onError,
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
      expect(lifecycle.status.value).toBe('idle')
      releaseSettlement()

      await expect(pending).rejects.toMatchObject({
        code: 'IDENTITY_CHANGED',
        kind: 'authentication',
      })
      expect(invoke).not.toHaveBeenCalled()
      expect(onSuccess).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
      expect(lifecycle.status.value).toBe('idle')
      expect(lifecycle.data.value).toBeUndefined()
    },
  )

  it('rejects when a synchronous pre-dispatch callback changes identity', async () => {
    let generation = 0
    const invoke = vi.fn(async () => 'unreachable')
    const lifecycle = makeLifecycle(
      {
        onStart: () => {
          generation += 1
        },
        invoke,
      },
      () => generation,
    )

    await expect(lifecycle.run({})).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not dispatch before settlement completes', async () => {
    let releaseSettlement!: () => void
    const invoke = vi.fn(async () => 'done')
    const lifecycle = makeLifecycle({
      settle: () =>
        new Promise<void>((resolve) => {
          releaseSettlement = resolve
        }),
      invoke,
    })

    const pending = lifecycle.run({})
    await Promise.resolve()
    expect(invoke).not.toHaveBeenCalled()

    releaseSettlement()
    await expect(pending).resolves.toBe('done')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('keeps reset final while settlement is pending', async () => {
    let releaseSettlement!: () => void
    const onSuccess = vi.fn()
    const lifecycle = makeLifecycle({
      settle: () =>
        new Promise<void>((resolve) => {
          releaseSettlement = resolve
        }),
      invoke: async () => 'wire-result',
      onSuccess,
    })

    const pending = lifecycle.run({})
    lifecycle.reset()
    releaseSettlement()

    await expect(pending).resolves.toBe('wire-result')
    expect(onSuccess).not.toHaveBeenCalled()
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

    await expect(lifecycle.run({})).rejects.toMatchObject({
      kind: 'authentication',
    })
    expect(invoke).not.toHaveBeenCalled()
    expect(lifecycle.status.value).toBe('error')
  })

  it('disposal retires pending completion and rejects later calls', async () => {
    let releaseInvoke!: (value: string) => void
    const onSuccess = vi.fn()
    const lifecycle = makeLifecycle({
      invoke: () =>
        new Promise<string>((resolve) => {
          releaseInvoke = resolve
        }),
      onSuccess,
    })

    const pending = lifecycle.run({})
    lifecycle.dispose()
    lifecycle.dispose()
    releaseInvoke('late-result')

    await expect(pending).resolves.toBe('late-result')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(lifecycle.status.value).toBe('idle')
    expect(lifecycle.data.value).toBeUndefined()
    await expect(lifecycle.run({})).rejects.toMatchObject({
      code: 'CALL_DISPOSED',
    })
  })

  it('owns and releases its identity subscription exactly once', async () => {
    let generation = 1
    let notifyIdentityChange: (() => void) | undefined
    const stopIdentity = vi.fn()
    const controller = createCallableController<Record<string, unknown>, string>({
      operation: 'mutation',
      getIdentityGeneration: () => generation,
      subscribeIdentityChange(listener) {
        notifyIdentityChange = listener
        return stopIdentity
      },
      handlers: { invoke: async () => 'done' },
    })

    await expect(controller.run({})).resolves.toBe('done')
    expect(controller.data.value).toBe('done')
    generation = 2
    notifyIdentityChange?.()
    expect(controller.status.value).toBe('idle')
    expect(controller.data.value).toBeUndefined()

    controller.dispose()
    controller.dispose()
    expect(stopIdentity).toHaveBeenCalledTimes(1)
  })
})
