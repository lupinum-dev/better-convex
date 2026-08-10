import { createAuthClient } from 'better-auth/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'

import { createIntegratedAuthClient } from '../../src/runtime/auth/integrated-client'
import {
  createSessionSynchronization,
  type ProviderSessionRevision,
} from '../../src/runtime/auth/session-synchronization'

describe('integrated client against pinned Better Auth 1.7.0-rc.2', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the real canonical session refetch on resolve, reject, and sign-out', async () => {
    let serverSessionToken: string | null = null
    const fetchedPaths: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const rawUrl = input instanceof Request ? input.url : input.toString()
        const url = new URL(rawUrl)
        fetchedPaths.push(url.pathname)
        const data = serverSessionToken
          ? {
              session: { token: serverSessionToken },
              user: { id: `user:${serverSessionToken}` },
            }
          : { session: null, user: null }
        return Response.json(data)
      }),
    )

    const originalRejection = new Error('provider operation rejected')
    const raw = createAuthClient({
      baseURL: 'https://auth.example.test/api/auth',
      plugins: [
        {
          id: 'canonical-session-product-probe',
          getActions() {
            return {
              lab: {
                async signIn(name: string) {
                  serverSessionToken = `session:${name}`
                  return { data: { ok: true }, error: null }
                },
                async rejectAfterRotation() {
                  serverSessionToken = 'session:rotated-on-error'
                  throw originalRejection
                },
                async resultErrorAfterRotation() {
                  serverSessionToken = 'session:rotated-on-result-error'
                  return { data: null, error: { code: 'RESULT_ERROR' } }
                },
                async signOut() {
                  serverSessionToken = null
                  return { data: { success: true }, error: null }
                },
              },
            }
          },
        },
      ],
    })
    const canonicalSession = raw.useSession()
    let provider: ProviderSessionRevision | undefined
    let revision = 0
    const synchronization = createSessionSynchronization({
      timeoutMs: 1_000,
      async refetchCanonicalSession() {
        await canonicalSession.value.refetch()
        if (canonicalSession.value.error) throw new Error('canonical refresh failed')
      },
      failClosed: vi.fn(),
    })
    const stop = watch(
      [
        () => canonicalSession.value.data?.session?.token ?? null,
        () => canonicalSession.value.error,
      ] as const,
      ([sessionToken, error]) => {
        revision += 1
        provider = {
          sessionToken,
          revision,
          failed: error !== null,
        }
        synchronization.observeProvider(provider)
      },
      { flush: 'sync', immediate: true },
    )
    if (provider) {
      synchronization.observeAccepted(provider, false)
    }
    const integrated = createIntegratedAuthClient(raw, synchronization)

    const initialFetchCount = fetchedPaths.filter((path) => path.endsWith('/get-session')).length
    let signInSettled = false
    const signIn = integrated.lab.signIn('alice').then(() => {
      signInSettled = true
    })
    await vi.waitFor(() => {
      expect(canonicalSession.value.data?.session?.token).toBe('session:alice')
    })
    expect(signInSettled).toBe(false)
    expect(provider).toBeDefined()
    synchronization.observeAccepted(provider!, false)
    await signIn
    expect(signInSettled).toBe(true)
    expect(fetchedPaths.filter((path) => path.endsWith('/get-session'))).toHaveLength(
      initialFetchCount + 1,
    )

    let caught: unknown
    const rejected = integrated.lab.rejectAfterRotation().catch((error) => {
      caught = error
    })
    await vi.waitFor(() => {
      expect(canonicalSession.value.data?.session?.token).toBe('session:rotated-on-error')
    })
    expect(caught).toBeUndefined()
    synchronization.observeAccepted(provider!, false)
    await rejected
    expect(caught).toBe(originalRejection)

    let resultErrorSettled = false
    const resultError = integrated.lab.resultErrorAfterRotation().then((result) => {
      resultErrorSettled = true
      return result
    })
    await vi.waitFor(() => {
      expect(canonicalSession.value.data?.session?.token).toBe('session:rotated-on-result-error')
    })
    expect(resultErrorSettled).toBe(false)
    synchronization.observeAccepted(provider!, false)
    await expect(resultError).resolves.toEqual({
      data: null,
      error: { code: 'RESULT_ERROR' },
    })

    let signOutSettled = false
    const signOut = integrated.lab.signOut().then(() => {
      signOutSettled = true
    })
    await vi.waitFor(() => {
      expect(canonicalSession.value.data?.session?.token ?? null).toBeNull()
    })
    expect(signOutSettled).toBe(false)
    synchronization.observeAccepted(provider!, false)
    await signOut
    expect(signOutSettled).toBe(true)
    expect(fetchedPaths.filter((path) => path.endsWith('/get-session'))).toHaveLength(
      initialFetchCount + 4,
    )

    stop()
    synchronization.dispose()
  })
})
