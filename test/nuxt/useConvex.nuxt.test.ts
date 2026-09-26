import { mountSuspended } from '@nuxt/test-utils/runtime'
import { makeFunctionReference } from 'convex/server'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import { useNuxtApp } from '#imports'

import { useConvex } from '../../src/runtime/composables/useConvex'
import { useConvexConnectionState } from '../../src/runtime/composables/useConvexConnectionState'
import { UNAVAILABLE_CONVEX_HANDLE } from '../../src/runtime/utils/client-unavailable'
import { MockConvexClient } from '../helpers/mock-convex-client'
import { captureInNuxt } from '../helpers/nuxt-runtime-harness'

const listNotes = makeFunctionReference<'query'>('notes:list')

async function captureWithoutRuntime<T>(factory: () => T): Promise<T> {
  let result: T | undefined
  await mountSuspended(
    defineComponent({
      setup() {
        result = factory()
        return () => h('div')
      },
    }),
  )
  return result as T
}

describe('useConvex without a browser runtime', () => {
  // These run before the harness installs a runtime into this file's Nuxt app,
  // which is exactly an app built without a Convex URL.
  it('returns the stable unavailable handle instead of throwing', async () => {
    const { handle, hasRuntime } = await captureWithoutRuntime(() => ({
      handle: useConvex(),
      hasRuntime: Boolean(useNuxtApp().$convexRuntime),
    }))

    expect(hasRuntime).toBe(false)
    expect(handle).toBe(UNAVAILABLE_CONVEX_HANDLE)
    await expect(handle.query(listNotes, {})).rejects.toMatchObject({
      code: 'CLIENT_UNAVAILABLE',
      functionName: 'notes:list',
    })
  })

  it('reports the disconnected connection state', async () => {
    const state = await captureWithoutRuntime(() => useConvexConnectionState())

    expect(Object.isFrozen(state)).toBe(true)
    expect(state.isConnected.value).toBe(false)
    expect(state.isReconnecting.value).toBe(false)
    expect(state.pendingMutations.value).toBe(0)
    expect(state.state.value.hasEverConnected).toBe(false)
  })
})

describe('useConvex with the browser runtime', () => {
  it('returns the Vue-owned handle that dispatches to the current client', async () => {
    const convex = new MockConvexClient()
    convex.setQueryHandler('notes:list', () => ['first note'])

    const { result } = await captureInNuxt(() => useConvex(), {
      convex,
      convexConfig: { auth: false },
    })

    expect(result).not.toBe(UNAVAILABLE_CONVEX_HANDLE)
    await expect(result.query(listNotes, {})).resolves.toEqual(['first note'])
  })
})
