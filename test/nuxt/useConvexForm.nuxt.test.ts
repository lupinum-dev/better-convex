import type { FunctionReference } from 'convex/server'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { useConvexForm } from '../../src/runtime/composables/useConvexForm'
import type { DevtoolsSink } from '../../src/runtime/devtools/sink'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt } from '../helpers/nuxt-runtime-harness'

describe('useConvexForm (Nuxt runtime)', () => {
  it('uses one mutation lifecycle and records one ordinary DevTools event', async () => {
    const convex = new MockConvexClient()
    const mutation = mockFnRef<'mutation'>('testing:save-form') as FunctionReference<
      'mutation',
      'public',
      { workspaceId: string; amountCents: number },
      string
    >
    convex.setMutationHandler('testing:save-form', async (args) =>
      String((args as { amountCents: number }).amountCents),
    )
    const registerMutation = vi.fn(() => 'form-event')
    const updateMutation = vi.fn()
    const sink = { registerMutation, updateMutation } as unknown as DevtoolsSink
    const { result, nuxtApp } = await captureInNuxt(
      () =>
        useConvexForm(mutation, {
          schema: z.object({ amount: z.number().positive() }),
          toArgs: ({ amount }) => ({ amountCents: Math.round(amount * 100) }),
        }),
      { convex },
    )
    const runtime = nuxtApp.$convexRuntime!
    const previous = runtime.getDevtoolsSink
    ;(runtime as { getDevtoolsSink: () => DevtoolsSink | null }).getDevtoolsSink = () => sink

    try {
      await expect(
        result.submit({ amount: 12.34 }, { workspaceId: 'workspace-1' }),
      ).resolves.toEqual({ ok: true, data: '1234' })
      expect(convex.calls.mutation).toHaveLength(1)
      expect(registerMutation).toHaveBeenCalledTimes(1)
      expect(registerMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'testing:save-form',
          type: 'mutation',
          args: { workspaceId: 'workspace-1', amountCents: 1234 },
        }),
      )
      expect(updateMutation).toHaveBeenCalledTimes(1)
    } finally {
      ;(runtime as { getDevtoolsSink: () => DevtoolsSink | null }).getDevtoolsSink = previous
    }
  })
})
