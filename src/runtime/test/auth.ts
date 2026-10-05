import type { BetterConvexTestAuthControl } from '@lupinum/better-convex-vue/test'
import { computed, readonly, shallowRef, type ComputedRef, type ShallowRef } from 'vue'

import { ConvexCallError } from '../errors'
import type { ConvexUser } from '../utils/types'

export type BetterConvexTestAuthPreset = 'authenticated' | 'anonymous' | 'pending' | 'error'

/**
 * Stands in for `useConvexAuth()`. Its verbs move the one test identity, so
 * every component using the test plugin sees the change through the real
 * auth port and client owner.
 */
export interface BetterConvexTestAuth {
  readonly status: ComputedRef<BetterConvexTestAuthPreset>
  readonly pending: ComputedRef<boolean>
  readonly user: Readonly<ShallowRef<ConvexUser | null>>
  readonly error: ComputedRef<ConvexCallError | undefined>
  readonly client: {
    readonly signIn: { email(input: Record<string, unknown>): Promise<BetterConvexTestAuthResult> }
    readonly signUp: { email(input: Record<string, unknown>): Promise<BetterConvexTestAuthResult> }
    signOut(): Promise<BetterConvexTestAuthResult>
  }
  ready(options?: { timeoutMs?: number }): Promise<BetterConvexTestAuthPreset>
  signIn(user?: ConvexUser): void
  signOut(): void
  /** Keep the user but replace the session; in-flight work of the old session is fenced. */
  renewSession(): void
  setLoading(): void
  fail(error: unknown): void
}

export interface BetterConvexTestAuthResult {
  readonly data: Record<string, never>
  readonly error: null
}

export const DEFAULT_TEST_USER: ConvexUser = Object.freeze({
  id: 'test-user',
  name: 'Test User',
  email: 'test@example.test',
  emailVerified: true,
})

const RESULT: BetterConvexTestAuthResult = Object.freeze({ data: Object.freeze({}), error: null })

function presentationError(error: unknown): ConvexCallError {
  return error instanceof ConvexCallError
    ? error
    : new ConvexCallError({
        kind: 'authentication',
        message: error instanceof Error ? error.message : String(error),
      })
}

/** The Nuxt `useConvexAuth()` presentation over the test identity. */
export function createBetterConvexTestAuth(
  control: BetterConvexTestAuthControl,
  initialUser: ConvexUser | null,
  initialError?: ConvexCallError,
): BetterConvexTestAuth {
  const status = shallowRef<BetterConvexTestAuthPreset>(control.status)
  const currentUser = shallowRef<ConvexUser | null>(initialUser)
  const currentError = shallowRef<ConvexCallError | undefined>(initialError)
  const settledWaiters = new Set<() => void>()

  control.subscribe(() => {
    status.value = control.status
    if (status.value === 'pending') return
    for (const settle of [...settledWaiters]) settle()
  })

  const waitForSettlement = (timeoutMs = 0) => {
    if (status.value !== 'pending') return Promise.resolve()
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const settle = () => {
        if (timer !== undefined) clearTimeout(timer)
        settledWaiters.delete(settle)
        resolve()
      }
      settledWaiters.add(settle)
      if (timeoutMs > 0) timer = setTimeout(settle, timeoutMs)
    })
  }

  const signIn = (user: ConvexUser = DEFAULT_TEST_USER) => {
    currentUser.value = user
    currentError.value = undefined
    control.signIn(user.id)
  }
  const signOut = () => {
    currentUser.value = null
    currentError.value = undefined
    control.signOut()
  }

  return Object.freeze({
    status: computed(() => status.value),
    pending: computed(() => status.value === 'pending'),
    user: readonly(currentUser),
    error: computed(() => currentError.value),
    client: Object.freeze({
      signIn: Object.freeze({
        async email() {
          signIn()
          return RESULT
        },
      }),
      signUp: Object.freeze({
        async email() {
          signIn()
          return RESULT
        },
      }),
      async signOut() {
        signOut()
        return RESULT
      },
    }),
    async ready(options?: { timeoutMs?: number }) {
      await waitForSettlement(options?.timeoutMs)
      return status.value
    },
    signIn,
    signOut,
    renewSession: () => control.renewSession(),
    setLoading() {
      currentUser.value = null
      currentError.value = undefined
      control.setLoading()
    },
    fail(error: unknown) {
      const presented = presentationError(error)
      currentUser.value = null
      currentError.value = presented
      control.fail(presented)
    },
  })
}
