import { describe, expect, it, vi } from 'vitest'

import { useRuntimeConfig } from '#imports'

const calls: string[] = []
let finishActivation!: () => void

vi.mock('../../src/runtime/composables/useConvexActivation', () => ({
  useConvexActivation: () => ({
    activate: () =>
      new Promise<void>((resolve) => {
        finishActivation = () => {
          calls.push('activated')
          resolve()
        }
      }),
  }),
}))

vi.mock('../../src/runtime/composables/useConvexAuth', () => ({
  useConvexAuth: () => {
    calls.push('auth read')
    return {
      status: { value: 'authenticated' },
      pending: { value: false },
      ready: async () => 'authenticated',
    }
  },
}))

describe('convex-auth route middleware in the browser', () => {
  it('reads auth only after an on-demand runtime finished starting', async () => {
    useRuntimeConfig().public.convex = { auth: { origin: 'http://localhost:3000' } }
    const middleware = (await import('../../src/runtime/middleware/convex-auth.global'))
      .default as unknown as (to: object) => Promise<unknown>

    const decision = middleware({
      path: '/account',
      fullPath: '/account',
      query: {},
      meta: { convexAuth: true },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Reading auth before the runtime exists would decide from the server state.
    expect(calls).toEqual([])

    finishActivation()
    await decision
    expect(calls).toEqual(['activated', 'auth read'])
  })
})
