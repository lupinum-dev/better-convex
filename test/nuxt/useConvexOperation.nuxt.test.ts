import type { FunctionReference } from 'convex/server'
import { describe, expect, it } from 'vitest'

import { useConvexFileUpload } from '../../src/runtime/composables/useConvexFileUpload'
import { useConvexOperation } from '../../src/runtime/composables/useConvexOperation'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt, installIdentityPortHarness } from '../helpers/nuxt-runtime-harness'

class FakeXhr {
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
    setTimeout(() => {
      this.status = 200
      this.responseText = JSON.stringify({ storageId: 'storage_1' })
      this.onload?.()
    }, 0)
  }
  abort() {
    this.onabort?.()
  }
}

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

describe('useConvexFileUpload completion (Nuxt runtime)', () => {
  it('completes an upload through the Nuxt client and names the phase that failed', async () => {
    const originalXhr = globalThis.XMLHttpRequest
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest
    try {
      const convex = new MockConvexClient()
      const prepare = mockFnRef<'mutation'>('files:session-nuxt') as FunctionReference<
        'mutation',
        'public',
        Record<string, never>,
        { uploadUrl: string; sessionId: string }
      >
      const attach = mockFnRef<'action'>('files:attach-nuxt') as FunctionReference<
        'action',
        'public',
        { sessionId: string; storageId: string },
        string
      >
      convex.setMutationHandler('files:session-nuxt', async () => ({
        uploadUrl: 'http://upload.local',
        sessionId: 'session_1',
      }))
      let fail = false
      convex.setActionHandler('files:attach-nuxt', async () => {
        if (fail) throw new Error('attach failed')
        return 'attached'
      })

      const { result } = await captureInNuxt(
        () =>
          useConvexFileUpload(prepare, {
            url: (session) => session.uploadUrl,
            complete: (op, { prepared, storageId }) =>
              op.action(attach, { sessionId: prepared.sessionId, storageId }),
          }),
        { convex },
      )
      const file = new File(['a'], 'a.txt', { type: 'text/plain' })

      await expect(result.upload(file)).resolves.toEqual({
        storageId: 'storage_1',
        prepared: { uploadUrl: 'http://upload.local', sessionId: 'session_1' },
        completed: 'attached',
      })
      expect(convex.calls.action[0]?.args).toEqual({
        sessionId: 'session_1',
        storageId: 'storage_1',
      })

      fail = true
      await expect(result.upload(file)).rejects.toMatchObject({
        phase: 'complete',
        functionName: 'files:attach-nuxt',
      })
      expect(result.error.value?.phase).toBe('complete')
    } finally {
      globalThis.XMLHttpRequest = originalXhr
    }
  })
})
