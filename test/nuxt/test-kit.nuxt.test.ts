import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import { useConvexAction } from '../../src/runtime/composables/useConvexAction'
import { useConvexFileUpload } from '../../src/runtime/composables/useConvexFileUpload'
import { useConvexMutation } from '../../src/runtime/composables/useConvexMutation'
import { useConvexOperation } from '../../src/runtime/composables/useConvexOperation'
import { useConvexPaginatedQuery } from '../../src/runtime/composables/useConvexPaginatedQuery'
import { useConvexQuery } from '../../src/runtime/composables/useConvexQuery'
import { setupBetterConvexTest } from '../../src/runtime/test'
import {
  createNote,
  defineTestKitScenarios,
  listNotes,
  type TestKitComposables,
} from '../unit/test-kit-scenarios'

// One copy of the Vue package: the Nuxt composables, the Nuxt test kit, and the
// shared scenarios all resolve the workspace sources (the published build
// shares one chunk graph the same way).
vi.mock('@lupinum/better-convex-vue', () => import('../../packages/vue/src/index'))
vi.mock('@lupinum/better-convex-vue/internal', () => import('../../packages/vue/src/internal'))
vi.mock('@lupinum/better-convex-vue/embedded', () => import('../../packages/vue/src/embedded'))
vi.mock('@lupinum/better-convex-vue/errors', () => import('../../packages/vue/src/errors'))
vi.mock('@lupinum/better-convex-vue/test', () => import('../../packages/vue/src/test'))

const composables = {
  useConvexQuery,
  useConvexPaginatedQuery,
  useConvexMutation,
  useConvexAction,
  useConvexFileUpload,
  useConvexOperation,
} as unknown as TestKitComposables

defineTestKitScenarios({
  name: 'Nuxt',
  composables,
  async mount(convex, setup) {
    let state!: ReturnType<typeof setup>
    const wrapper = await mountSuspended(
      defineComponent({
        setup() {
          state = setup()
          return () => h('div')
        },
      }),
      { global: { plugins: [convex.plugin] } },
    )
    return { state, unmount: () => wrapper.unmount() }
  },
})

describe('setupBetterConvexTest (Nuxt)', () => {
  it('drives the useConvexAuth double and the runtime identity together', async () => {
    const convex = setupBetterConvexTest()
    const notes = convex.query(listNotes)
    notes.resolve([])
    let query!: ReturnType<typeof useConvexQuery<typeof listNotes>>
    await mountSuspended(
      defineComponent({
        setup() {
          query = useConvexQuery(listNotes, { owner: 'me' }, { auth: 'required' })
          return () => h('div')
        },
      }),
      { global: { plugins: [convex.plugin] } },
    )
    await convex.flush()
    expect(convex.auth.status.value).toBe('authenticated')
    expect(convex.auth.user.value?.id).toBe('test-user')
    expect(notes.calls.at(-1)?.identity).toBe('user:test-user')

    await convex.auth.client.signOut()
    await nextTick()
    expect(convex.auth.status.value).toBe('anonymous')
    expect(convex.auth.user.value).toBeNull()
    expect(query.status.value).toBe('idle')
    expect(notes.activeSubscriptions()).toBe(0)

    convex.auth.signIn({ id: 'romi', name: 'Romi' })
    await convex.flush()
    expect(notes.calls.at(-1)?.identity).toBe('user:romi')
    await convex.dispose()
  })

  it('presents auth failures with the public vocabulary and fences writes', async () => {
    const convex = setupBetterConvexTest()
    const create = convex.mutation(createNote)
    let mutation!: ReturnType<typeof useConvexMutation<typeof createNote>>
    await mountSuspended(
      defineComponent({
        setup() {
          mutation = useConvexMutation(createNote)
          return () => h('div')
        },
      }),
      { global: { plugins: [convex.plugin] } },
    )
    const pending = mutation.mutate({ title: 'Before failure' })
    const request = await create.nextCall()

    convex.auth.fail(new Error('provider unavailable'))
    expect(convex.auth.status.value).toBe('error')
    expect(convex.auth.error.value).toMatchObject({
      kind: 'authentication',
      message: 'provider unavailable',
    })
    request.resolve('stale')
    await expect(pending).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
    await convex.dispose()
  })

  it('honors ready() timeouts without inventing a settled identity', async () => {
    const convex = setupBetterConvexTest({ auth: 'pending' })

    await expect(convex.auth.ready({ timeoutMs: 1 })).resolves.toBe('pending')
    convex.auth.signIn()
    await expect(convex.auth.ready()).resolves.toBe('authenticated')
    await convex.dispose()
  })
})
