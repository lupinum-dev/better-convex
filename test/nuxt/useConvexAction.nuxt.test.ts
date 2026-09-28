import { ConvexError } from 'convex/values'
import { describe, expect, it, vi } from 'vitest'
import { isProxy } from 'vue'

import { useConvexAction } from '../../src/runtime/composables/useConvexAction'
import type { DevtoolsSink } from '../../src/runtime/devtools/sink'
import { ConvexCallError, isConvexCallError } from '../../src/runtime/errors'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt, installIdentityPortHarness } from '../helpers/nuxt-runtime-harness'

describe('useConvexAction (Nuxt runtime)', () => {
  it('disposes its controller and identity listener with the component scope', async () => {
    const action = mockFnRef<'action'>('testing:disposed-action')
    const { result, wrapper } = await captureInNuxt(() => {
      const identity = installIdentityPortHarness()
      return { action: useConvexAction(action), identity }
    })

    wrapper.unmount()
    result.identity.advance()
    await expect(result.action.run({} as never)).rejects.toMatchObject({
      code: 'CANCELLED',
      functionName: 'testing:disposed-action',
    })
  })

  it('dispatches through the action transport and exposes the shared call lifecycle', async () => {
    const convex = new MockConvexClient()
    const action = mockFnRef<'action'>('testing:echo-action')
    convex.setActionHandler('testing:echo-action', async (args) => ({ ok: true, args }))

    const { result } = await captureInNuxt(() => useConvexAction(action), { convex })

    expect(Object.keys(result)).toEqual(['run', 'data', 'status', 'pending', 'error', 'reset'])
    const pending = result.run({ message: 'hello' } as never)
    expect(result.pending.value).toBe(true)

    await expect(pending).resolves.toEqual({ ok: true, args: { message: 'hello' } })
    expect(convex.calls.action).toHaveLength(1)
    expect(convex.calls.action[0]?.action).toEqual(action)
    expect(convex.calls.action[0]?.args).toEqual({ message: 'hello' })
    expect(result.status.value).toBe('success')
    expect(result.error.value).toBeUndefined()
    expect(result.data.value).toEqual({ ok: true, args: { message: 'hello' } })
    expect('safe' in result).toBe(false)

    result.reset()
    expect(result.status.value).toBe('idle')
    expect(result.data.value).toBeUndefined()
  })

  it('names normalized failures and keeps developer-authored application text', async () => {
    const convex = new MockConvexClient()
    const action = mockFnRef<'action'>('testing:failing-action')
    convex.setActionHandler('testing:failing-action', async () => {
      throw new ConvexError({ code: 'QUOTA', message: 'Monthly quota reached' })
    })

    const { result } = await captureInNuxt(() => useConvexAction(action), { convex })

    const rejection: unknown = await result.run({} as never).catch((error: unknown) => error)
    expect(isConvexCallError(rejection, 'QUOTA')).toBe(true)
    expect(rejection).toMatchObject({
      kind: 'server',
      message: 'Monthly quota reached',
      functionName: 'testing:failing-action',
    })
    expect(result.error.value).toBe(rejection)
  })

  it('exposes the exact settled result and error rather than proxies', async () => {
    const convex = new MockConvexClient()
    const action = mockFnRef<'action'>('testing:exact-action')
    const settled = { nested: { id: 'n1' } }
    let fail = false
    convex.setActionHandler('testing:exact-action', async () => {
      if (fail) throw new Error('action failed')
      return settled
    })

    const { result } = await captureInNuxt(() => useConvexAction(action), { convex })

    await expect(result.run({} as never)).resolves.toBe(settled)
    expect(result.data.value).toBe(settled)
    expect(isProxy(result.data.value)).toBe(false)

    fail = true
    const rejection: unknown = await result.run({} as never).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(ConvexCallError)
    expect(result.error.value).toBe(rejection)
    expect(isProxy(result.error.value)).toBe(false)
  })

  it('dispatches an empty object for an argless action', async () => {
    const convex = new MockConvexClient()
    const action = mockFnRef<'action'>('testing:argless-action')
    convex.setActionHandler('testing:argless-action', async (args) => args)

    const { result } = await captureInNuxt(() => useConvexAction(action), { convex })

    await expect(result.run()).resolves.toEqual({})
    expect(convex.calls.action.at(-1)?.args).toEqual({})
  })

  it('dispatches when DevTools registration throws', async () => {
    const convex = new MockConvexClient()
    const action = mockFnRef<'action'>('testing:diagnostics-registration')
    convex.setActionHandler('testing:diagnostics-registration', async () => 'committed')
    const registerMutation = vi.fn(() => {
      throw new Error('diagnostics unavailable')
    })
    const sink = { registerMutation } as unknown as DevtoolsSink
    const { result, nuxtApp } = await captureInNuxt(() => useConvexAction(action), { convex })
    const runtime = nuxtApp.$convexRuntime!
    const previous = runtime.getDevtoolsSink
    ;(runtime as { getDevtoolsSink: () => DevtoolsSink | null }).getDevtoolsSink = () => sink

    try {
      await expect(result.run({} as never)).resolves.toBe('committed')
      expect(convex.calls.action).toHaveLength(1)
      expect(registerMutation).toHaveBeenCalledTimes(1)
    } finally {
      ;(runtime as { getDevtoolsSink: () => DevtoolsSink | null }).getDevtoolsSink = previous
    }
  })

  it('keeps committed and failed call outcomes when DevTools updates throw', async () => {
    const convex = new MockConvexClient()
    const action = mockFnRef<'action'>('testing:diagnostics-update')
    const remoteFailure = new ConvexCallError({ kind: 'server', message: 'remote failure' })
    convex.setActionHandler('testing:diagnostics-update', async (args) => {
      if ((args as { fail?: boolean }).fail) throw remoteFailure
      return 'committed'
    })
    const updateMutation = vi.fn(() => {
      throw new Error('diagnostics unavailable')
    })
    const sink = {
      registerMutation: () => 'event-1',
      updateMutation,
    } as unknown as DevtoolsSink
    const { result, nuxtApp } = await captureInNuxt(() => useConvexAction(action), { convex })
    const runtime = nuxtApp.$convexRuntime!
    const previous = runtime.getDevtoolsSink
    ;(runtime as { getDevtoolsSink: () => DevtoolsSink | null }).getDevtoolsSink = () => sink

    try {
      await expect(result.run({} as never)).resolves.toBe('committed')
      // The call path adds its function name to a boundary error it did not name.
      await expect(result.run({ fail: true } as never)).rejects.toMatchObject({
        ...remoteFailure.toJSON(),
        functionName: 'testing:diagnostics-update',
      })
      expect(updateMutation).toHaveBeenCalledTimes(2)
    } finally {
      ;(runtime as { getDevtoolsSink: () => DevtoolsSink | null }).getDevtoolsSink = previous
    }
  })
})
