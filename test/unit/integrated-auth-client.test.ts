import { createAuthClient } from 'better-auth/vue'
import { describe, expect, it, vi } from 'vitest'
import { isRef } from 'vue'

import {
  createIntegratedAuthClient,
  type CanonicalSessionReconciler,
} from '../../src/runtime/auth/integrated-client'
import { createAuthOperationTracker } from '../../src/runtime/auth/operation-tracker'

function reconciler(
  overrides: Partial<CanonicalSessionReconciler> = {},
): CanonicalSessionReconciler {
  return {
    checkpoint: vi.fn(() => ({ revision: 0 })),
    cancel: vi.fn(),
    reconcile: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('integrated Better Auth client', () => {
  it('matches the pinned Better Auth callable proxy while preserving synchronous APIs', () => {
    const rememberedReceivers = new WeakSet<object>()
    const raw = createAuthClient({
      baseURL: 'https://auth.example.test/api/auth',
      plugins: [
        {
          id: 'integrated-client-test',
          getActions() {
            return {
              lab: {
                rememberReceiver() {
                  rememberedReceivers.add(this as object)
                },
                hasRememberedReceiver() {
                  return rememberedReceivers.has(this as object)
                },
                returnReceiver() {
                  return this
                },
                permission(value: number) {
                  return value > 0
                },
              },
              convex: {
                token: async () => ({ data: { token: 'raw-convex-jwt' } }),
              },
            }
          },
        },
      ],
    })
    const integrated = createIntegratedAuthClient(raw, reconciler())

    // Better Auth 1.7.0-rc.2 exposes a callable root and callable namespaces.
    expect(typeof raw).toBe('function')
    expect(typeof raw.lab).toBe('function')
    const session = integrated.useSession()
    expect(isRef(session)).toBe(true)
    expect(session).not.toBeInstanceOf(Promise)
    expect(integrated.lab.permission(1)).toBe(true)
    expect(integrated.lab.permission(0)).toBe(false)

    integrated.lab.rememberReceiver()
    expect(integrated.lab.hasRememberedReceiver()).toBe(true)
    expect(integrated.lab.returnReceiver()).toBe(integrated.lab)
    expect(integrated.lab.permission).toBe(integrated.lab.permission)

    expect((integrated as Record<string, unknown>).then).toBeUndefined()
    expect((integrated as Record<string, unknown>).$fetch).toBeUndefined()
    expect((integrated as Record<string, unknown>).$store).toBeUndefined()
    expect((integrated as Record<string, unknown>).hydrateSession).toBeUndefined()
    expect((integrated as Record<string, unknown>).convex).toBeUndefined()
    expect('$fetch' in integrated).toBe(false)
    expect('convex' in integrated).toBe(false)
    expect(Reflect.ownKeys(integrated)).not.toContain('$fetch')
    expect(Reflect.ownKeys(integrated)).not.toContain('$store')
    expect(Reflect.ownKeys(integrated)).not.toContain('convex')
    expect(Object.getOwnPropertyDescriptor(integrated, '$fetch')).toBeUndefined()
    expect(Object.getOwnPropertyDescriptor(integrated, '$store')).toBeUndefined()
    expect(Object.getOwnPropertyDescriptor(integrated, 'hydrateSession')).toBeUndefined()
    expect(Object.getOwnPropertyDescriptor(integrated, 'convex')).toBeUndefined()
    expect(Object.getOwnPropertyDescriptors(integrated)).not.toHaveProperty('$fetch')
    expect(Object.getOwnPropertyDescriptors(integrated)).not.toHaveProperty('$store')
    expect(Object.getOwnPropertyDescriptors(integrated)).not.toHaveProperty('convex')
    expect(() => Object.preventExtensions(integrated)).toThrow(TypeError)
  })

  it('reconciles fulfilled, rejected, and result-error Promise operations', async () => {
    const originalFailure = new Error('operation failed after rotating its cookie')
    const reconcile = vi.fn(async () => {})
    const integrated = createIntegratedAuthClient(
      {
        success: () => Promise.resolve({ data: { ok: true }, error: null }),
        resultError: () => Promise.resolve({ data: null, error: { code: 'BAD_INPUT' } }),
        reject: () => Promise.reject(originalFailure),
        thenable: () => ({ then: (resolve: (value: string) => void) => resolve('thenable') }),
      },
      reconciler({ reconcile }),
    )

    await expect(integrated.success()).resolves.toEqual({ data: { ok: true }, error: null })
    await expect(integrated.resultError()).resolves.toEqual({
      data: null,
      error: { code: 'BAD_INPUT' },
    })
    await expect(integrated.reject()).rejects.toBe(originalFailure)
    await expect(integrated.thenable()).resolves.toBe('thenable')
    expect(reconcile).toHaveBeenCalledTimes(4)
  })

  it('does not expose a Promise outcome until reconciliation settles', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const integrated = createIntegratedAuthClient(
      { signOut: async () => ({ data: { success: true }, error: null }) },
      reconciler({ reconcile: vi.fn(() => gate) }),
    )
    let settled = false
    const operation = integrated.signOut().then(() => {
      settled = true
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await operation
    expect(settled).toBe(true)
  })

  it('keeps native bound actions inside the reconciliation boundary', async () => {
    const originalFailure = new Error('bound action failed')
    const reconcile = vi.fn(async () => {})
    const integrated = createIntegratedAuthClient(
      {
        success: async () => 'bound success',
        reject: async () => {
          throw originalFailure
        },
        echo<Value>(value: Value): Value {
          return value
        },
      },
      reconciler({ reconcile }),
    )

    const boundSuccess = integrated.success.bind(null)
    const boundReject = integrated.reject.bind(null)
    const echoedSuccess = integrated.echo(integrated.success)

    expect(echoedSuccess).toBe(integrated.success)
    await expect(boundSuccess()).resolves.toBe('bound success')
    await expect(boundReject()).rejects.toBe(originalFailure)
    await expect(echoedSuccess()).resolves.toBe('bound success')
    expect(reconcile).toHaveBeenCalledTimes(3)
  })

  it('returns synchronous results unchanged and surfaces sync reconciliation failure', () => {
    const value = { allowed: true }
    const cancelFailure = new Error('synchronous session change')
    const normal = createIntegratedAuthClient({ permission: () => value }, reconciler())
    expect(normal.permission()).toBe(value)

    const unsafe = createIntegratedAuthClient(
      { unsafeSyncMutation: () => value },
      reconciler({
        cancel: vi.fn(() => {
          throw cancelFailure
        }),
      }),
    )
    expect(() => unsafe.unsafeSyncMutation()).toThrow(cancelFailure)
  })

  it('tracks concurrent Promise operations without serializing their invocation', async () => {
    const tracker = createAuthOperationTracker()
    const releases: Array<() => void> = []
    const invoked: string[] = []
    const integrated = createIntegratedAuthClient(
      {
        operation(name: string) {
          invoked.push(name)
          return new Promise<string>((resolve) => releases.push(() => resolve(name)))
        },
      },
      reconciler(),
      tracker.track,
    )

    const first = integrated.operation('first')
    const second = integrated.operation('second')
    expect(invoked).toEqual(['first', 'second'])
    expect(tracker.isPending.value).toBe(true)

    releases[1]?.()
    await second
    expect(tracker.isPending.value).toBe(true)
    releases[0]?.()
    await first
    expect(tracker.isPending.value).toBe(false)
  })

  it('keeps the root non-thenable', async () => {
    const integrated = createIntegratedAuthClient(
      { then: () => Promise.resolve('raw then') },
      reconciler(),
    )
    await expect(Promise.resolve(integrated)).resolves.toBe(integrated)
  })
})
