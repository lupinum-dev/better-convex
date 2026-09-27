import { ConvexError } from 'convex/values'
import { describe, expect, it, vi } from 'vitest'

import { useConvexMutation } from '../../src/runtime/composables/useConvexMutation'
import type { DevtoolsSink } from '../../src/runtime/devtools/sink'
import { isConvexCallError } from '../../src/runtime/errors'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt } from '../helpers/nuxt-runtime-harness'

describe('useConvexMutation (Nuxt runtime)', () => {
  it('returns a frozen destructurable lifecycle with a mutate verb', async () => {
    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('testing:save-note')
    convex.setMutationHandler('testing:save-note', async (args) => ({ saved: args }))

    const { result } = await captureInNuxt(() => useConvexMutation(mutation), { convex })

    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.keys(result)).toEqual(['mutate', 'data', 'status', 'pending', 'error', 'reset'])
    const { mutate, status, pending, data, reset } = result

    const call = mutate({ title: 'Hello' } as never)
    expect(pending.value).toBe(true)
    await expect(call).resolves.toEqual({ saved: { title: 'Hello' } })
    expect(convex.calls.mutation).toHaveLength(1)
    expect(status.value).toBe('success')
    expect(data.value).toEqual({ saved: { title: 'Hello' } })

    reset()
    expect(status.value).toBe('idle')
    expect(data.value).toBeUndefined()
  })

  it('rejects with a named ConvexCallError that keeps application text', async () => {
    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('testing:reject-note')
    convex.setMutationHandler('testing:reject-note', async () => {
      throw new ConvexError('Title is already taken')
    })

    const { result } = await captureInNuxt(() => useConvexMutation(mutation), { convex })

    const rejection: unknown = await result.mutate({} as never).catch((error: unknown) => error)
    expect(isConvexCallError(rejection)).toBe(true)
    expect(rejection).toMatchObject({
      kind: 'server',
      message: 'Title is already taken',
      data: 'Title is already taken',
      functionName: 'testing:reject-note',
    })
    expect(result.status.value).toBe('error')
    expect(result.error.value).toBe(rejection)
  })

  it('records optimistic mutations in DevTools', async () => {
    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('testing:optimistic-note')
    convex.setMutationHandler('testing:optimistic-note', async () => 'committed')
    const registerMutation = vi.fn(() => 'event-1')
    const updateMutation = vi.fn()
    const sink = { registerMutation, updateMutation } as unknown as DevtoolsSink

    const { result, nuxtApp } = await captureInNuxt(
      () => useConvexMutation(mutation, { optimisticUpdate: () => undefined }),
      { convex },
    )
    const runtime = nuxtApp.$convexRuntime!
    const previous = runtime.getDevtoolsSink
    ;(runtime as { getDevtoolsSink: () => DevtoolsSink | null }).getDevtoolsSink = () => sink

    try {
      await expect(result.mutate({} as never)).resolves.toBe('committed')
      expect(registerMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'testing:optimistic-note',
          type: 'mutation',
          state: 'optimistic',
          hasOptimisticUpdate: true,
        }),
      )
      expect(updateMutation).toHaveBeenCalledWith(
        'event-1',
        expect.objectContaining({ state: 'success' }),
      )
    } finally {
      ;(runtime as { getDevtoolsSink: () => DevtoolsSink | null }).getDevtoolsSink = previous
    }
  })
})
