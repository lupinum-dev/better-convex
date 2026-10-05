import type { FunctionReference } from 'convex/server'
import { describe, expect, it } from 'vitest'

import { useConvexOperation } from '../../src/runtime/composables/useConvexOperation'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt, installIdentityPortHarness } from '../helpers/nuxt-runtime-harness'

describe('useConvexOperation (Nuxt runtime)', () => {
  it('runs steps through the Nuxt client, fences them to the identity at run(), and masks state', async () => {
    const convex = new MockConvexClient()
    const createNote = mockFnRef<'mutation'>('notes:create-operation') as FunctionReference<
      'mutation',
      'public',
      { title: string },
      string
    >
    convex.setMutationHandler('notes:create-operation', async () => 'note_1')
    let identity!: ReturnType<typeof installIdentityPortHarness>
    let releaseSecond!: () => void
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })

    const { result: publish } = await captureInNuxt(
      () => {
        identity = installIdentityPortHarness()
        return useConvexOperation(async (op, title: string, waitBeforeSecond: boolean) => {
          const first = await op.mutation(createNote, { title })
          if (waitBeforeSecond) await secondGate
          await op.mutation(createNote, { title: `${title} again` })
          return first
        })
      },
      { convex },
    )

    await expect(publish.run('a', false)).resolves.toBe('note_1')
    expect(publish.data.value).toBe('note_1')
    expect(publish.status.value).toBe('success')

    const crossed = publish.run('b', true)
    await expect.poll(() => convex.calls.mutation.length).toBe(3)
    identity.advance()
    expect(publish.status.value).toBe('idle')
    expect(publish.data.value).toBeUndefined()
    releaseSecond()
    await expect(crossed).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
      outcome: 'not-sent',
    })
    expect(convex.calls.mutation).toHaveLength(3)
    expect(publish.error.value).toBeUndefined()

    // A new run belongs to the new identity.
    await expect(publish.run('c', false)).resolves.toBe('note_1')
    expect(convex.calls.mutation).toHaveLength(5)
  })
})
