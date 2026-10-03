import { describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'

import { useNuxtApp, useState } from '#imports'

import {
  ANONYMOUS_IDENTITY,
  LOADING_IDENTITY,
  toAuthenticatedIdentity,
  type AuthIdentity,
} from '../../src/runtime/auth/auth-identity'
import { useConvexAuth } from '../../src/runtime/composables/useConvexAuth'
import { ConvexCallError } from '../../src/runtime/errors'
import type { NuxtConvexAuthController } from '../../src/runtime/runtime-context'
import { UNAVAILABLE_AUTH_CLIENT } from '../../src/runtime/utils/client-unavailable'
import { captureInNuxt } from '../helpers/nuxt-runtime-harness'

function controller(overrides: Partial<NuxtConvexAuthController> = {}): NuxtConvexAuthController {
  return {
    pending: computed(() => false),
    client: {},
    ready: vi.fn(async () => 'anonymous' as const),
    dispose: vi.fn(),
    ...overrides,
  }
}

describe('useConvexAuth Nuxt facade', () => {
  it('derives loading, authenticated, anonymous, and error from canonical Nuxt state', async () => {
    const { result } = await captureInNuxt(
      () => {
        const identity = useState<AuthIdentity>('convex:identity')
        const pending = useState<boolean>('convex:pending')
        const authError = useState<string | null>('convex:authError')
        identity.value = LOADING_IDENTITY
        pending.value = true
        authError.value = null
        return { auth: useConvexAuth(), identity, pending, authError }
      },
      { convexConfig: { auth: { origin: 'http://localhost:3000' } } },
    )

    expect(result.auth.status.value).toBe('loading')
    expect(result.auth.error.value).toBeUndefined()
    result.identity.value = toAuthenticatedIdentity({ id: 'alice' })
    result.pending.value = false
    expect(result.auth.status.value).toBe('authenticated')
    expect(result.auth.user.value?.id).toBe('alice')

    result.identity.value = ANONYMOUS_IDENTITY
    expect(result.auth.status.value).toBe('anonymous')
    result.authError.value = 'Authentication is temporarily unavailable'
    expect(result.auth.status.value).toBe('error')
    expect(result.auth.error.value).toMatchObject({ kind: 'authentication' })
    expect(Object.keys(result.auth)).not.toContain('token')
    expect(Object.keys(result.auth)).not.toContain('isAuthenticated')
  })

  it('exposes only the per-app integrated client and delegates ready', async () => {
    const integratedClient = {
      useSession: vi.fn(() => ({ value: { isPending: false } })),
      signIn: { email: vi.fn(async () => ({ data: {}, error: null })) },
    }
    const authController = controller({ client: integratedClient })
    const { result } = await captureInNuxt(
      () => {
        useNuxtApp().$convexRuntime!.attachAuthController(authController)
        return useConvexAuth()
      },
      { convexConfig: { auth: { origin: 'http://localhost:3000' } } },
    )

    expect(result.client).toBe(integratedClient)
    expect(result.client?.useSession()).toEqual({ value: { isPending: false } })
    await result.ready({ timeoutMs: 5 })
    expect(authController.ready).toHaveBeenCalledWith({ timeoutMs: 5 })
    expect(Object.keys(result)).not.toContain('signIn')
    expect(Object.keys(result)).not.toContain('signOut')
    expect(Object.keys(result)).not.toContain('refresh')
  })

  it('keeps two captured application controllers isolated', async () => {
    const firstClient = { app: 'first' }
    const secondClient = { app: 'second' }
    const first = controller({
      client: firstClient,
      ready: vi.fn(async () => 'authenticated' as const),
    })
    const second = controller({
      client: secondClient,
      ready: vi.fn(async () => 'anonymous' as const),
    })
    const firstResult = await captureInNuxt(
      () => {
        useNuxtApp().$convexRuntime!.attachAuthController(first)
        return useConvexAuth()
      },
      { convexConfig: { auth: { origin: 'http://localhost:3000' } } },
    )
    expect(firstResult.result.client).toBe(firstClient)
    expect(await firstResult.result.ready()).toBe('authenticated')
    firstResult.wrapper.unmount()

    const secondResult = await captureInNuxt(
      () => {
        useNuxtApp().$convexRuntime!.attachAuthController(second)
        return useConvexAuth()
      },
      { convexConfig: { auth: { origin: 'http://localhost:3000' } } },
    )
    expect(secondResult.result.client).toBe(secondClient)
    expect(await secondResult.result.ready()).toBe('anonymous')
    expect(first.ready).toHaveBeenCalledOnce()
    expect(second.ready).toHaveBeenCalledOnce()
  })

  it('returns a non-null inert client before the browser auth runtime exists', async () => {
    const { result } = await captureInNuxt(
      () => {
        // Destructuring during setup must never throw.
        const { client, status, user } = useConvexAuth()
        const { signIn, useSession } = client as unknown as {
          signIn: { email: (input: unknown) => unknown }
          useSession: () => unknown
        }
        return { client, status, user, signIn, useSession }
      },
      { convexConfig: { auth: { origin: 'http://localhost:3000' } } },
    )

    expect(result.client).toBe(UNAVAILABLE_AUTH_CLIENT)
    expect(result.status.value).toBe('anonymous')
    expect(result.user.value).toBeNull()
    let thrown: unknown
    try {
      result.signIn.email({ email: 'ada@example.test', password: 'secret' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ConvexCallError)
    expect(thrown).toMatchObject({ kind: 'unknown', code: 'CLIENT_UNAVAILABLE' })
    expect((thrown as Error).message).toContain('useConvexAuth().client.signIn.email()')
    expect(() => result.useSession()).toThrow(ConvexCallError)
  })
})
